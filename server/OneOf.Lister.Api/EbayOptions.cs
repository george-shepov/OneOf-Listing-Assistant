namespace OneOf.Lister.Api;

public sealed class EbayOptions
{
    public const string SectionName = "Ebay";

    public string Environment { get; set; } = "Sandbox";
    public string UserAccessToken { get; set; } = string.Empty;
    public string MarketplaceId { get; set; } = "EBAY_US";
    public string ContentLanguage { get; set; } = "en-US";
    public string Currency { get; set; } = "USD";
    public string MerchantLocationKey { get; set; } = string.Empty;
    public string MerchantLocationName { get; set; } = "OneOf Inventory";
    public string FulfillmentPolicyId { get; set; } = string.Empty;
    public string PaymentPolicyId { get; set; } = string.Empty;
    public string ReturnPolicyId { get; set; } = string.Empty;
    public LocationAddressOptions LocationAddress { get; set; } = new();

    public bool IsSandbox => !Environment.Equals("Production", StringComparison.OrdinalIgnoreCase);
    public string ApiRoot => IsSandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
    public string MediaApiRoot => IsSandbox ? "https://apim.sandbox.ebay.com" : "https://apim.ebay.com";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(UserAccessToken) &&
        !string.IsNullOrWhiteSpace(MerchantLocationKey) &&
        !string.IsNullOrWhiteSpace(FulfillmentPolicyId) &&
        !string.IsNullOrWhiteSpace(PaymentPolicyId) &&
        !string.IsNullOrWhiteSpace(ReturnPolicyId);
}

public sealed class LocationAddressOptions
{
    public string AddressLine1 { get; set; } = string.Empty;
    public string AddressLine2 { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string StateOrProvince { get; set; } = string.Empty;
    public string PostalCode { get; set; } = string.Empty;
    public string Country { get; set; } = "US";

    public bool CanCreateLocation =>
        !string.IsNullOrWhiteSpace(AddressLine1) &&
        !string.IsNullOrWhiteSpace(City) &&
        !string.IsNullOrWhiteSpace(StateOrProvince) &&
        !string.IsNullOrWhiteSpace(PostalCode) &&
        !string.IsNullOrWhiteSpace(Country);
}
