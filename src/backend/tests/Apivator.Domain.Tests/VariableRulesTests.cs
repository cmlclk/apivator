using Apivator.Domain.Variables;

namespace Apivator.Domain.Tests;

public class VariableRulesTests
{
    [Fact]
    public void Clean_TrimsKeys_AndDropsEmptyRows()
    {
        var (variables, violation, _) = VariableRules.CleanChecked([new Variable("  baseUrl ", "https://x.test"), new Variable("", "boş"), new Variable("   ", "x")]);

        Assert.Null(violation);
        var only = Assert.Single(variables);
        Assert.Equal("baseUrl", only.Key);
    }

    [Theory]
    [InlineData("{{x}}")]
    [InlineData("a}}")]
    public void Clean_RejectsBracesInKey(string key)
    {
        var (_, violation, _) = VariableRules.CleanChecked([new Variable(key, "v")]);
        Assert.NotNull(violation);
    }

    [Fact]
    public void Clean_RejectsTooManyVariables()
    {
        var many = Enumerable.Range(0, VariableRules.MaxCount + 1).Select(i => new Variable($"k{i}", "v"));
        Assert.NotNull(VariableRules.CleanChecked(many).Violation);
    }

    [Fact]
    public void Clean_TreatsNullAsEmpty() => Assert.Empty(VariableRules.CleanChecked(null).Variables);
}
