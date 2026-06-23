using System.Text.Json.Serialization;

namespace OneOf.Lister.Api;

public sealed record PublishListingRequest
{
    public string Sku { get; init; } = string.Empty;
    public string MarketplaceId { get; init; } = "EBAY_US";
    public string Title { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string CategoryId { get; init; } = string.Empty;
    public string Condition { get; init; } = string.Empty;
    public string ConditionDescription { get; init; } = string.Empty;
    public string Brand { get; init; } = string.Empty;
    public string Upc { get; init; } = string.Empty;
    public int Quantity { get; init; } = 1;
    public decimal Price { get; init; }
    public decimal MinPrice { get; init; }
    public string Currency { get; init; } = "USD";
    public Dictionary<string, string[]> Aspects { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public PackageRequest Package { get; init; } = new();
    public string MerchantLocationKey { get; init; } = string.Empty;
    public string FulfillmentPolicyId { get; init; } = string.Empty;
    public string PaymentPolicyId { get; init; } = string.Empty;
    public string ReturnPolicyId { get; init; } = string.Empty;
}

public sealed record PackageRequest
{
    public decimal Length { get; init; }
    public decimal Width { get; init; }
    public decimal Height { get; init; }
    public decimal Weight { get; init; }
    [JsonIgnore]
    public bool HasAnyValue => Length > 0 || Width > 0 || Height > 0 || Weight > 0;
}

public sealed record PublishListingResult(
    string Sku,
    string OfferId,
    string ListingId,
    string ListingUrl,
    IReadOnlyList<string> ImageUrls);

public sealed record ListingMetricsRequest(
    int Impressions,
    int Views,
    int Watchers,
    int Sales,
    int AgeDays,
    int Returns,
    bool HasCategory,
    int AspectCount,
    bool IsComplete);

public sealed record OptimizationRecommendation(
    string Health,
    int Score,
    string Action,
    string Title,
    string Reason);

internal sealed record EbayImageResponse(
    string? ExpirationDate,
    string? ImageUrl,
    string? MaxDimensionImageUrl);

internal sealed record EbayOfferResponse(string? OfferId);
internal sealed record EbayPublishResponse(string? ListingId);
