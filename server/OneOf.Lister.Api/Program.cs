using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Options;
using OneOf.Lister.Api;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<EbayOptions>(builder.Configuration.GetSection(EbayOptions.SectionName));
builder.Services.Configure<FormOptions>(options => options.MultipartBodyLengthLimit = 150 * 1024 * 1024);
builder.Services.AddHttpClient<EbayApiClient>(client => client.Timeout = TimeSpan.FromMinutes(3));
builder.Services.AddSingleton<OptimizerService>();
builder.Services.AddProblemDetails();

var allowedOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>() ??
    ["https://george-shepov.github.io", "http://localhost:8080", "http://127.0.0.1:8080"];

builder.Services.AddCors(options => options.AddPolicy("frontend", policy =>
    policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
app.UseExceptionHandler();
app.UseCors("frontend");

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "OneOf.Lister.Api", utc = DateTimeOffset.UtcNow }));

app.MapGet("/api/ebay/status", (IOptions<EbayOptions> options) =>
{
    var value = options.Value;
    return Results.Ok(new
    {
        configured = value.IsConfigured,
        environment = value.IsSandbox ? "Sandbox" : "Production",
        marketplaceId = value.MarketplaceId,
        merchantLocationKey = value.MerchantLocationKey,
        missing = new[]
        {
            string.IsNullOrWhiteSpace(value.UserAccessToken) ? "UserAccessToken" : null,
            string.IsNullOrWhiteSpace(value.MerchantLocationKey) ? "MerchantLocationKey" : null,
            string.IsNullOrWhiteSpace(value.FulfillmentPolicyId) ? "FulfillmentPolicyId" : null,
            string.IsNullOrWhiteSpace(value.PaymentPolicyId) ? "PaymentPolicyId" : null,
            string.IsNullOrWhiteSpace(value.ReturnPolicyId) ? "ReturnPolicyId" : null,
        }.Where(item => item is not null)
    });
});

app.MapPost("/api/optimizer/analyze", (ListingMetricsRequest request, OptimizerService optimizer) =>
    Results.Ok(optimizer.Analyze(request)));

app.MapPost("/api/ebay/listings/publish", async (
    HttpRequest request,
    EbayApiClient ebay,
    CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
        return Results.BadRequest(new { message = "Use multipart/form-data with a metadata field and one or more images." });

    var form = await request.ReadFormAsync(cancellationToken);
    var metadataJson = form["metadata"].FirstOrDefault();
    if (string.IsNullOrWhiteSpace(metadataJson))
        return Results.BadRequest(new { message = "The metadata form field is required." });

    PublishListingRequest? metadata;
    try
    {
        metadata = JsonSerializer.Deserialize<PublishListingRequest>(metadataJson, new JsonSerializerOptions(JsonSerializerDefaults.Web));
    }
    catch (JsonException exception)
    {
        return Results.BadRequest(new { message = "Metadata JSON is invalid.", detail = exception.Message });
    }

    if (metadata is null) return Results.BadRequest(new { message = "Metadata is required." });

    try
    {
        var result = await ebay.PublishAsync(metadata, form.Files, cancellationToken);
        return Results.Ok(result);
    }
    catch (EbayValidationException exception)
    {
        return Results.ValidationProblem(exception.Errors.ToDictionary(error => error, error => new[] { error }));
    }
    catch (EbayApiException exception)
    {
        return Results.Problem(
            title: $"eBay operation failed: {exception.Operation}",
            detail: exception.ResponseBody,
            statusCode: (int)exception.StatusCode);
    }
});

app.Run();
