using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Apivator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddForks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "kind",
                table: "notifications",
                type: "character varying(30)",
                maxLength: 30,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20);

            migrationBuilder.AlterColumn<Guid>(
                name: "comment_id",
                table: "notifications",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.CreateTable(
                name: "collection_forks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    fork_collection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_collection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_pulled_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_collection_forks", x => x.id);
                    table.ForeignKey(
                        name: "fk_collection_forks_collections_fork_collection_id",
                        column: x => x.fork_collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_collection_forks_collections_source_collection_id",
                        column: x => x.source_collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "fork_links",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    fork_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    source_item_id = table.Column<Guid>(type: "uuid", nullable: false),
                    fork_item_id = table.Column<Guid>(type: "uuid", nullable: false),
                    @base = table.Column<string>(name: "base", type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_fork_links", x => x.id);
                    table.ForeignKey(
                        name: "fk_fork_links_collection_forks_fork_id",
                        column: x => x.fork_id,
                        principalTable: "collection_forks",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "merge_requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    fork_id = table.Column<Guid>(type: "uuid", nullable: true),
                    source_collection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    fork_collection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "character varying(10000)", maxLength: 10000, nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    author_id = table.Column<Guid>(type: "uuid", nullable: false),
                    approvals = table.Column<string>(type: "jsonb", nullable: false),
                    merged_changes = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    closed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    closed_by_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_merge_requests", x => x.id);
                    table.ForeignKey(
                        name: "fk_merge_requests_collection_forks_fork_id",
                        column: x => x.fork_id,
                        principalTable: "collection_forks",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_merge_requests_collections_source_collection_id",
                        column: x => x.source_collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_merge_requests_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_collection_forks_fork_collection_id",
                table: "collection_forks",
                column: "fork_collection_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_collection_forks_source_collection_id",
                table: "collection_forks",
                column: "source_collection_id");

            migrationBuilder.CreateIndex(
                name: "ix_fork_links_fork_id",
                table: "fork_links",
                column: "fork_id");

            migrationBuilder.CreateIndex(
                name: "ix_merge_requests_fork_collection_id",
                table: "merge_requests",
                column: "fork_collection_id");

            migrationBuilder.CreateIndex(
                name: "ix_merge_requests_fork_id",
                table: "merge_requests",
                column: "fork_id");

            migrationBuilder.CreateIndex(
                name: "ix_merge_requests_source_collection_id_status",
                table: "merge_requests",
                columns: new[] { "source_collection_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_merge_requests_workspace_id_status",
                table: "merge_requests",
                columns: new[] { "workspace_id", "status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "fork_links");

            migrationBuilder.DropTable(
                name: "merge_requests");

            migrationBuilder.DropTable(
                name: "collection_forks");

            migrationBuilder.AlterColumn<string>(
                name: "kind",
                table: "notifications",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(30)",
                oldMaxLength: 30);

            migrationBuilder.AlterColumn<Guid>(
                name: "comment_id",
                table: "notifications",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
