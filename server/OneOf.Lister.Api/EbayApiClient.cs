using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace OneOf.Lister.Api;

public sealed class EbayApiClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private readonly HttpClient _http;
    private readonly EbayOptions _options;
    private readonly ILogger<EbayApiClient> _logger;

    public EbayApiClient(HttpClient http, IOptions<EbayOptions> options, ILogger<EbayApiClient> logger)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<PublishListingResult> PublishAsync(
        PublishListingRequest request,
        IReadOnlyCollection<IFormFile> images,
        CancellationToken cancellationToken)
    {
        Validate(request, images);
        var normalized = ApplyDefaults(request);

        await EnsureInventoryLocationAsync(normalized.MerchantLocationKey, cancellationToken);

        var imageUrls = new List<string>();
        foreach (var image in images.Take(24))
            imageUrls.Add(await UploadImageAsync(image, cancellationToken));

        await CreateOrReplaceInventoryItemAsync(normalized, imageUrls, cancellationToken);
        var offerId = await CreateOfferAsync(normalized, cancellationToken);
        var listingId = await PublishOfferAsync(offerId, cancellationToken);
        var listingHost = _options.IsSandbox ? "https://www.sandbox.ebay.com" : "https://www.ebay.com";

        return new PublishListingResult(
            normalized.Sku,
            offerId,
            listingId,
            $"{listingHost}/itm/{Uri.EscapeDataString(listingId)}",
            imageUrls);
    }

    private PublishListingRequest ApplyDefaults(PublishListingRequest request) => request with
    {
        MarketplaceId = ValueOrDefault(request.MarketplaceId, _options.MarketplaceId),
        Currency = ValueOrDefault(request.Currency, _options.Currency),
        MerchantLocationKey = ValueOrDefault(request.MerchantLocationKey, _options.MerchantLocationKey),
        FulfillmentPolicyId = ValueOrDefault(request.FulfillmentPolicyId, _options.FulfillmentPolicyId),
        PaymentPolicyId = ValueOrDefault(request.PaymentPolicyId, _options.PaymentPolicyId),
        ReturnPolicyId = ValueOrDefault(request.ReturnPolicyId, _options.ReturnPolicyId),
    };

    private static string ValueOrDefault(string value, string fallback) =>
        string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();

    private void Validate(PublishListingRequest request, IReadOnlyCollection<IFormFile> images)
    {
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(_options.UserAccessToken)) errors.Add("Ebay:UserAccessToken is not configured.");
        if (string.IsNullOrWhiteSpace(request.Sku)) errors.Add("SKU is required.");
        if (request.Sku.Length > 50) errors.Add("SKU cannot exceed 50 characters.");
        if (string.IsNullOrWhiteSpace(request.Title)) errors.Add("Title is required.");
        if (request.Title.Length > 80) errors.Add("Title cannot exceed 80 characters.");
        if (string.IsNullOrWhiteSpace(request.Description)) errors.Add("Description is required.");
        if (string.IsNullOrWhiteSpace(request.CategoryId)) errors.Add("Category ID is required.");
        if (string.IsNullOrWhiteSpace(request.Condition)) errors.Add("Condition is required.");
        if (request.Price <= 0) errors.Add("Price must be greater than zero.");
        if (request.Quantity < 1) errors.Add("Quantity must be at least one.");
        if (images.Count == 0) errors.Add("At least one image is required.");

        var normalized = ApplyDefaults(request);
        if (string.IsNullOrWhiteSpace(normalized.MerchantLocationKey)) errors.Add("Merchant location key is required.");
        if (string.IsNullOrWhiteSpace(normalized.FulfillmentPolicyId)) errors.Add("Fulfillment policy ID is required.");
        if (string.IsNullOrWhiteSpace(normalized.PaymentPolicyId)) errors.Add("Payment policy ID is required.");
        if (string.IsNullOrWhiteSpace(normalized.ReturnPolicyId)) errors.Add("Return policy ID is required.");

        if (errors.Count > 0) throw new EbayValidationException(errors);
    }

    private async Task EnsureInventoryLocationAsync(string locationKey, CancellationToken cancellationToken)
    {
        using var get = CreateRequest(HttpMethod.Get, $"{_options.ApiRoot}/sell/inventory/v1/location/{Uri.EscapeDataString(locationKey)}");
        using var response = await _http.SendAsync(get, cancellationToken);
        if (response.IsSuccessStatusCode) return;
        if (response.StatusCode != HttpStatusCode.NotFound)
            throw await CreateApiExceptionAsync("Check inventory location", response, cancellationToken);

        if (!_options.LocationAddress.CanCreateLocation)
            throw new InvalidOperationException($"Inventory location '{locationKey}' does not exist and Ebay:LocationAddress is incomplete.");

        var address = _options.LocationAddress;
        var payload = new
        {
            location = new
            {
                address = new
                {
                    addressLine1 = address.AddressLine1,
                    addressLine2 = string.IsNullOrWhiteSpace(address.AddressLine2) ? null : address.AddressLine2,
                    city = address.City,
                    stateOrProvince = address.StateOrProvince,
                    postalCode = address.PostalCode,
                    country = address.Country
                }
            },
            locationTypes = new[] { "WAREHOUSE" },
            merchantLocationStatus = "ENABLED",
            name = _options.MerchantLocationName
        };

        using var create = CreateJsonRequest(HttpMethod.Post,
            $"{_options.ApiRoot}/sell/inventory/v1/location/{Uri.EscapeDataString(locationKey)}", payload);
        using var createResponse = await _http.SendAsync(create, cancellationToken);
        if (!createResponse.IsSuccessStatusCode)
            throw await CreateApiExceptionAsync("Create inventory location", createResponse, cancellationToken);
    }

    private async Task<string> UploadImageAsync(IFormFile image, CancellationToken cancellationToken)
    {
        using var content = new MultipartFormDataContent();
        await using var stream = image.OpenReadStream();
        using var imageContent = new StreamContent(stream);
        imageContent.Headers.ContentType = MediaTypeHeaderValue.Parse(
            string.IsNullOrWhiteSpace(image.ContentType) ? "application/octet-stream" : image.ContentType);
        content.Add(imageContent, "image", image.FileName);

        using var request = CreateRequest(HttpMethod.Post,
            $"{_options.MediaApiRoot}/commerce/media/v1_beta/image/create_image_from_file");
        request.Content = content;
        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw await CreateApiExceptionAsync($"Upload image '{image.FileName}'", response, cancellationToken);

        var result = await response.Content.ReadFromJsonAsync<EbayImageResponse>(JsonOptions, cancellationToken);
        if (string.IsNullOrWhiteSpace(result?.ImageUrl))
            throw new InvalidOperationException($"eBay uploaded '{image.FileName}' but did not return an image URL.");
        return result.ImageUrl;
    }

    private async Task CreateOrReplaceInventoryItemAsync(
        PublishListingRequest request,
        IReadOnlyList<string> imageUrls,
        CancellationToken cancellationToken)
    {
        var product = new Dictionary<string, object?>
        {
            ["title"] = request.Title,
            ["description"] = request.Description,
            ["imageUrls"] = imageUrls,
            ["aspects"] = request.Aspects,
            ["brand"] = string.IsNullOrWhiteSpace(request.Brand) ? null : request.Brand,
        };
        if (!string.IsNullOrWhiteSpace(request.Upc)) product["upc"] = new[] { request.Upc };

        var payload = new Dictionary<string, object?>
        {
            ["availability"] = new { shipToLocationAvailability = new { quantity = request.Quantity } },
            ["condition"] = request.Condition,
            ["conditionDescription"] = string.IsNullOrWhiteSpace(request.ConditionDescription) ? null : request.ConditionDescription,
            ["product"] = product,
        };

        if (request.Package.HasAnyValue)
        {
            payload["packageWeightAndSize"] = new
            {
                dimensions = request.Package.Length > 0 && request.Package.Width > 0 && request.Package.Height > 0
                    ? new { length = request.Package.Length, width = request.Package.Width, height = request.Package.Height, unit = "INCH" }
                    : null,
                weight = request.Package.Weight > 0 ? new { value = request.Package.Weight, unit = "POUND" } : null,
                shippingIrregular = false
            };
        }

        using var httpRequest = CreateJsonRequest(HttpMethod.Put,
            $"{_options.ApiRoot}/sell/inventory/v1/inventory_item/{Uri.EscapeDataString(request.Sku)}", payload);
        using var response = await _http.SendAsync(httpRequest, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw await CreateApiExceptionAsync("Create inventory item", response, cancellationToken);
    }

    private async Task<string> CreateOfferAsync(PublishListingRequest request, CancellationToken cancellationToken)
    {
        var payload = new
        {
            sku = request.Sku,
            marketplaceId = request.MarketplaceId,
            format = "FIXED_PRICE",
            availableQuantity = request.Quantity,
            categoryId = request.CategoryId,
            merchantLocationKey = request.MerchantLocationKey,
            listingDescription = request.Description,
            listingDuration = "GTC",
            includeCatalogProductDetails = !string.IsNullOrWhiteSpace(request.Upc),
            pricingSummary = new
            {
                price = new { value = request.Price.ToString("0.00", CultureInfo.InvariantCulture), currency = request.Currency }
            },
            listingPolicies = new
            {
                fulfillmentPolicyId = request.FulfillmentPolicyId,
                paymentPolicyId = request.PaymentPolicyId,
                returnPolicyId = request.ReturnPolicyId
            }
        };

        using var httpRequest = CreateJsonRequest(HttpMethod.Post, $"{_options.ApiRoot}/sell/inventory/v1/offer", payload);
        using var response = await _http.SendAsync(httpRequest, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw await CreateApiExceptionAsync("Create offer", response, cancellationToken);

        var result = await response.Content.ReadFromJsonAsync<EbayOfferResponse>(JsonOptions, cancellationToken);
        if (string.IsNullOrWhiteSpace(result?.OfferId)) throw new InvalidOperationException("eBay did not return an offer ID.");
        return result.OfferId;
    }

    private async Task<string> PublishOfferAsync(string offerId, CancellationToken cancellationToken)
    {
        using var request = CreateRequest(HttpMethod.Post,
            $"{_options.ApiRoot}/sell/inventory/v1/offer/{Uri.EscapeDataString(offerId)}/publish");
        request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
        request.Headers.TryAddWithoutValidation("Content-Language", _options.ContentLanguage);
        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw await CreateApiExceptionAsync("Publish offer", response, cancellationToken);

        var result = await response.Content.ReadFromJsonAsync<EbayPublishResponse>(JsonOptions, cancellationToken);
        if (string.IsNullOrWhiteSpace(result?.ListingId)) throw new InvalidOperationException("eBay did not return a listing ID.");
        return result.ListingId;
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string url)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.UserAccessToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return request;
    }

    private HttpRequestMessage CreateJsonRequest(HttpMethod method, string url, object payload)
    {
        var request = CreateRequest(method, url);
        request.Headers.TryAddWithoutValidation("Content-Language", _options.ContentLanguage);
        request.Content = JsonContent.Create(payload, options: JsonOptions);
        return request;
    }

    private async Task<Exception> CreateApiExceptionAsync(string operation, HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        _logger.LogError("eBay {Operation} failed with {StatusCode}: {Body}", operation, response.StatusCode, body);
        return new EbayApiException(operation, response.StatusCode, body);
    }
}

public sealed class EbayValidationException : Exception
{
    public EbayValidationException(IReadOnlyList<string> errors) : base(string.Join(" ", errors)) => Errors = errors;
    public IReadOnlyList<string> Errors { get; }
}

public sealed class EbayApiException : Exception
{
    public EbayApiException(string operation, HttpStatusCode statusCode, string responseBody)
        : base($"{operation} failed with {(int)statusCode} {statusCode}. {responseBody}")
    {
        Operation = operation;
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
    public string Operation { get; }
    public HttpStatusCode StatusCode { get; }
    public string ResponseBody { get; }
}
