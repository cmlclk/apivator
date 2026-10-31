using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Apivator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAuth : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "auth",
                table: "folders",
                type: "jsonb",
                nullable: false,
                defaultValueSql: "'{\"type\":\"Inherit\"}'::jsonb"); // mevcut klasörler üstten miras alır

            migrationBuilder.AddColumn<string>(
                name: "auth",
                table: "collections",
                type: "jsonb",
                nullable: false,
                defaultValueSql: "'{\"type\":\"None\"}'::jsonb"); // mevcut collection'lar yetkilendirmesiz
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "auth",
                table: "folders");

            migrationBuilder.DropColumn(
                name: "auth",
                table: "collections");
        }
    }
}
