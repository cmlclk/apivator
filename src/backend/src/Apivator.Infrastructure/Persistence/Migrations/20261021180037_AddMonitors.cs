using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Apivator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMonitors : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "monitor_id",
                table: "collection_runs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "request_errors",
                table: "collection_runs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "collection_monitors",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    collection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    environment_id = table.Column<Guid>(type: "uuid", nullable: true),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    schedule = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    time_zone = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false),
                    notify_emails = table.Column<string>(type: "jsonb", nullable: false),
                    webhook_url = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    webhook_kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    notify_mode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    next_run_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_run_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    health = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    consecutive_failures = table.Column<int>(type: "integer", nullable: false),
                    last_error = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    locked_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_collection_monitors", x => x.id);
                    table.ForeignKey(
                        name: "fk_collection_monitors_collections_collection_id",
                        column: x => x.collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_collection_monitors_environments_environment_id",
                        column: x => x.environment_id,
                        principalTable: "environments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_collection_monitors_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_collection_runs_monitor_id_started_at",
                table: "collection_runs",
                columns: new[] { "monitor_id", "started_at" });

            migrationBuilder.CreateIndex(
                name: "ix_collection_monitors_collection_id",
                table: "collection_monitors",
                column: "collection_id");

            migrationBuilder.CreateIndex(
                name: "ix_collection_monitors_environment_id",
                table: "collection_monitors",
                column: "environment_id");

            migrationBuilder.CreateIndex(
                name: "ix_collection_monitors_next_run_at",
                table: "collection_monitors",
                column: "next_run_at",
                filter: "enabled");

            migrationBuilder.CreateIndex(
                name: "ix_collection_monitors_workspace_id",
                table: "collection_monitors",
                column: "workspace_id");

            migrationBuilder.AddForeignKey(
                name: "fk_collection_runs_collection_monitors_monitor_id",
                table: "collection_runs",
                column: "monitor_id",
                principalTable: "collection_monitors",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_collection_runs_collection_monitors_monitor_id",
                table: "collection_runs");

            migrationBuilder.DropTable(
                name: "collection_monitors");

            migrationBuilder.DropIndex(
                name: "ix_collection_runs_monitor_id_started_at",
                table: "collection_runs");

            migrationBuilder.DropColumn(
                name: "monitor_id",
                table: "collection_runs");

            migrationBuilder.DropColumn(
                name: "request_errors",
                table: "collection_runs");
        }
    }
}
