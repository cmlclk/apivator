using Apivator.Application.Execution;

namespace Apivator.Api.IntegrationTests;

/// <summary>Sunucudaki dinamik değişkenler (runner ve monitörler) ortak sözleşmeye uyar. Veritabanı gerektirmez.</summary>
public class DynamicValuesTests
{
    private const int Samples = 200;

    public static TheoryData<string> Names() => new(DynamicVariableContract.Rules.Select(r => r.Name));

    [Fact]
    public void Names_MatchContract()
    {
        Assert.Equal(
            DynamicVariableContract.Rules.Select(r => r.Name).Order(StringComparer.Ordinal),
            DynamicValues.Names.Order(StringComparer.Ordinal));
    }

    [Theory]
    [MemberData(nameof(Names))]
    public void Value_MatchesFormatRangeAndAlgorithm(string name)
    {
        var rule = DynamicVariableContract.Get(name);
        for (var i = 0; i < Samples; i++)
        {
            var now = DateTimeOffset.UtcNow;
            var value = VariableResolver.Resolve($"{{{{{name}}}}}", _ => null);
            var problem = DynamicVariableContract.Violation(rule, value, now);
            Assert.True(problem is null, $"{name}: {problem}: {value}");
        }
    }

    [Fact]
    public void UnknownNames_StayUnresolved()
    {
        foreach (var name in DynamicVariableContract.Unresolved)
        {
            var missing = new HashSet<string>();
            Assert.Equal($"{{{{{name}}}}}", VariableResolver.Resolve($"{{{{{name}}}}}", _ => null, missing));
            Assert.Contains(name, missing);
        }
    }

    [Fact]
    public void DefinedVariable_WinsOverDynamic()
    {
        Assert.Equal("sabit", VariableResolver.Resolve("{{$randomEmail}}", n => n == "$randomEmail" ? "sabit" : null));
    }
}
