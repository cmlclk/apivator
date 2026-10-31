using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Apivator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMockServers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "mock_servers",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    collection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    environment_id = table.Column<Guid>(type: "uuid", nullable: true),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    key = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    is_private = table.Column<bool>(type: "boolean", nullable: false),
                    delay_ms = table.Column<int>(type: "integer", nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_mock_servers", x => x.id);
                    table.ForeignKey(
                        name: "fk_mock_servers_collections_collection_id",
                        column: x => x.collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_mock_servers_environments_environment_id",
                        column: x => x.environment_id,
                        principalTable: "environments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_mock_servers_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "mock_calls",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    mock_server_id = table.Column<Guid>(type: "uuid", nullable: false),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    method = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    path = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    request_headers = table.Column<string>(type: "jsonb", nullable: false),
                    request_body = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<int>(type: "integer", nullable: false),
                    example_id = table.Column<Guid>(type: "uuid", nullable: true),
                    matched_name = table.Column<string>(type: "character varying(420)", maxLength: 420, nullable: true),
                    error = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    duration_ms = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_mock_calls", x => x.id);
                    table.ForeignKey(
                        name: "fk_mock_calls_mock_servers_mock_server_id",
                        column: x => x.mock_server_id,
                        principalTable: "mock_servers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_mock_calls_mock_server_id_at",
                table: "mock_calls",
                columns: new[] { "mock_server_id", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_mock_servers_collection_id",
                table: "mock_servers",
                column: "collection_id");

            migrationBuilder.CreateIndex(
                name: "ix_mock_servers_environment_id",
                table: "mock_servers",
                column: "environment_id");

            migrationBuilder.CreateIndex(
                name: "ix_mock_servers_key",
                table: "mock_servers",
                column: "key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_mock_servers_workspace_id",
                table: "mock_servers",
                column: "workspace_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "mock_calls");

            migrationBuilder.DropTable(
                name: "mock_servers");
        }
    }
}
