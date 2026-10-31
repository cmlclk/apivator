using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Apivator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCollectionSources : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "source_key",
                table: "requests",
                type: "character varying(600)",
                maxLength: 600,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "collection_sources",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    collection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    url = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    local = table.Column<bool>(type: "boolean", nullable: false),
                    document = table.Column<string>(type: "text", nullable: false),
                    document_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    document_version = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    imported_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    pending_document = table.Column<string>(type: "text", nullable: true),
                    pending_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    check_interval_hours = table.Column<int>(type: "integer", nullable: true),
                    check_owner_id = table.Column<Guid>(type: "uuid", nullable: true),
                    next_check_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    locked_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_checked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_check_error = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    change_detected_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    notified_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_collection_sources", x => x.id);
                    table.ForeignKey(
                        name: "fk_collection_sources_collections_collection_id",
                        column: x => x.collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_collection_sources_users_check_owner_id",
                        column: x => x.check_owner_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_collection_sources_users_updated_by_id",
                        column: x => x.updated_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_collection_sources_check_owner_id",
                table: "collection_sources",
                column: "check_owner_id");

            migrationBuilder.CreateIndex(
                name: "ix_collection_sources_collection_id",
                table: "collection_sources",
                column: "collection_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_collection_sources_next_check_at",
                table: "collection_sources",
                column: "next_check_at",
                filter: "check_interval_hours IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_collection_sources_updated_by_id",
                table: "collection_sources",
                column: "updated_by_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "collection_sources");

            migrationBuilder.DropColumn(
                name: "source_key",
                table: "requests");
        }
    }
}
