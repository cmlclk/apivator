# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Önce yalnızca proje dosyaları: restore katmanı kod değişmedikçe önbellekten gelir.
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY src/Apivator.Domain/Apivator.Domain.csproj src/Apivator.Domain/
COPY src/Apivator.Application/Apivator.Application.csproj src/Apivator.Application/
COPY src/Apivator.Infrastructure/Apivator.Infrastructure.csproj src/Apivator.Infrastructure/
COPY src/Apivator.Api/Apivator.Api.csproj src/Apivator.Api/
RUN dotnet restore src/Apivator.Api/Apivator.Api.csproj

COPY src/ src/
RUN dotnet publish src/Apivator.Api/Apivator.Api.csproj -c Release -o /app --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
COPY --from=build /app .
USER $APP_UID
ENTRYPOINT ["dotnet", "Apivator.Api.dll"]
