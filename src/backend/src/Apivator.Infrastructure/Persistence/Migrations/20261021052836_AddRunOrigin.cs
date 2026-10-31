using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Apivator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRunOrigin : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "origin",
                table: "collection_runs",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Server");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "origin",
                table: "collection_runs");
        }
    }
}
