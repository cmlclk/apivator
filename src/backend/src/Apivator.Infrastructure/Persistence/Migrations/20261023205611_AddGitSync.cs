using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Apivator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddGitSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "collection_git_syncs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    collection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    remote_url = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    branch = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    folder_path = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    username = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    protected_token = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: true),
                    base_snapshot = table.Column<string>(type: "jsonb", nullable: false),
                    last_commit = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    last_synced_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_synced_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    remote_head = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    behind = table.Column<int>(type: "integer", nullable: false),
                    last_checked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_error = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    connected_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    connected_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    check_interval_hours = table.Column<int>(type: "integer", nullable: true),
                    next_check_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    locked_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    consecutive_failures = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_collection_git_syncs", x => x.id);
                    table.ForeignKey(
                        name: "fk_collection_git_syncs_collections_collection_id",
                        column: x => x.collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_collection_git_syncs_users_connected_by_id",
                        column: x => x.connected_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_collection_git_syncs_users_last_synced_by_id",
                        column: x => x.last_synced_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "ix_audit_log_created_at",
                table: "audit_log",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "ix_collection_git_syncs_collection_id",
                table: "collection_git_syncs",
                column: "collection_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_collection_git_syncs_connected_by_id",
                table: "collection_git_syncs",
                column: "connected_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_collection_git_syncs_last_synced_by_id",
                table: "collection_git_syncs",
                column: "last_synced_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_collection_git_syncs_next_check_at",
                table: "collection_git_syncs",
                column: "next_check_at",
                filter: "check_interval_hours IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "collection_git_syncs");

            migrationBuilder.DropIndex(
                name: "ix_audit_log_created_at",
                table: "audit_log");
        }
    }
}
