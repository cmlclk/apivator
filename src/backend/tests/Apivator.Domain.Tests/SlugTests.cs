using Apivator.Domain.Common;

namespace Apivator.Domain.Tests;

public class SlugTests
{
    [Theory]
    [InlineData("Ayşe Yılmaz", "ayse-yilmaz")]
    [InlineData("ÇĞİÖŞÜ Takımı", "cgiosu-takimi")]
    [InlineData("  Ödeme  API  v2 ", "odeme-api-v2")]
    [InlineData("!!!", "workspace")]
    [InlineData("", "workspace")]
    public void From_ProducesUrlSafeSlug(string input, string expected) =>
        Assert.Equal(expected, Slug.From(input));

    [Fact]
    public void From_TruncatesLongInput()
    {
        var slug = Slug.From(new string('a', 200));
        Assert.True(slug.Length <= Slug.MaxLength);
    }
}
