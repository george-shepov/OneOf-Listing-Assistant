namespace OneOf.Lister.Api;

public sealed class OptimizerService
{
    public OptimizationRecommendation Analyze(ListingMetricsRequest input)
    {
        var clickThroughRate = input.Impressions > 0 ? (decimal)input.Views / input.Impressions : 0;
        var conversionRate = input.Views > 0 ? (decimal)input.Sales / input.Views : 0;

        if (!input.HasCategory || input.AspectCount < 2)
            return new("discovery", 25, "category_specifics", "Correct category and item specifics",
                "Search visibility is limited when the category or product attributes are incomplete.");

        if (input.AgeDays >= 7 && input.Impressions < 25)
            return new("discovery", 35, "title", "Rewrite the title for search intent",
                $"Only {input.Impressions} impressions after {input.AgeDays} days. Verify brand, model, size, item type, and high-value keywords.");

        if (input.Impressions >= 100 && clickThroughRate < 0.01m)
            return new("conversion", 45, "primary_photo", "Replace the primary photo first",
                $"Click-through is {clickThroughRate:P1} from {input.Impressions} impressions, suggesting the hero image or title is not earning clicks.");

        if (input.Views >= 10 && input.Sales == 0 && input.Watchers == 0)
            return new("conversion", 55, "description_shipping", "Strengthen condition, description, and shipping",
                $"{input.Views} shoppers opened the listing without watching or buying. Remove uncertainty before changing price.");

        if (input.Watchers >= 2 && input.Sales == 0)
            return new("conversion", 65, "offer_shipping", "Send an offer or improve shipping",
                $"{input.Watchers} watchers indicate demand. Test an offer or shipping adjustment before reducing the public price.");

        if (input.AgeDays >= 60 && input.Sales == 0 && input.Views >= 5)
            return new("price", 40, "price", "Review price against the configured floor",
                $"The listing is {input.AgeDays} days old with traffic but no sale. Price is now the last unresolved lever.");

        if (!input.IsComplete)
            return new("discovery", 30, "completeness", "Complete the listing data",
                "Required publishing or buyer-facing fields are missing.");

        return new("healthy", Math.Min(100, 75 + (int)Math.Round(conversionRate * 100)), "monitor",
            "Monitor without changing the listing",
            "The current funnel does not show a strong failure signal. Avoid unnecessary revisions.");
    }
}
