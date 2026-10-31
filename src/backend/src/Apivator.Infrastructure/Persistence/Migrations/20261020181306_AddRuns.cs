using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Apivator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRuns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "collection_runs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    collection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    folder_id = table.Column<Guid>(type: "uuid", nullable: true),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    environment_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    iterations = table.Column<int>(type: "integer", nullable: false),
                    delay_ms = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    finished_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    total_requests = table.Column<int>(type: "integer", nullable: false),
                    failed_requests = table.Column<int>(type: "integer", nullable: false),
                    tests_passed = table.Column<int>(type: "integer", nullable: false),
                    tests_failed = table.Column<int>(type: "integer", nullable: false),
                    tests_skipped = table.Column<int>(type: "integer", nullable: false),
                    total_time_ms = table.Column<double>(type: "double precision", nullable: false),
                    results = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_collection_runs", x => x.id);
                    table.ForeignKey(
                        name: "fk_collection_runs_collections_collection_id",
                        column: x => x.collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_collection_runs_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_collection_runs_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_collection_runs_collection_id_started_at",
                table: "collection_runs",
                columns: new[] { "collection_id", "started_at" });

            migrationBuilder.CreateIndex(
                name: "ix_collection_runs_user_id",
                table: "collection_runs",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_collection_runs_workspace_id_started_at",
                table: "collection_runs",
                columns: new[] { "workspace_id", "started_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "collection_runs");
        }
    }
}
