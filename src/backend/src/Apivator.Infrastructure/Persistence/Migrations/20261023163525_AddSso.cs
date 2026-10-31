using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Apivator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSso : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "organization_sso",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false),
                    enforced = table.Column<bool>(type: "boolean", nullable: false),
                    authority = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    client_id = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    protected_client_secret = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    auto_provision = table.Column<bool>(type: "boolean", nullable: false),
                    default_role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organization_sso", x => x.id);
                    table.ForeignKey(
                        name: "fk_organization_sso_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sso_link_requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    login_provider = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    subject = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_sso_link_requests", x => x.id);
                    table.ForeignKey(
                        name: "fk_sso_link_requests_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_sso_link_requests_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sso_login_codes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    code_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    client_challenge = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_sso_login_codes", x => x.id);
                    table.ForeignKey(
                        name: "fk_sso_login_codes_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sso_login_tickets",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    state_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    protected_code_verifier = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    nonce = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    client_challenge = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    return_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    client_state = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_sso_login_tickets", x => x.id);
                    table.ForeignKey(
                        name: "fk_sso_login_tickets_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sso_domains",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    sso_id = table.Column<Guid>(type: "uuid", nullable: false),
                    domain = table.Column<string>(type: "character varying(253)", maxLength: 253, nullable: false),
                    verification_token = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    verified_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_checked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    failed_checks = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_sso_domains", x => x.id);
                    table.ForeignKey(
                        name: "fk_sso_domains_organization_sso_sso_id",
                        column: x => x.sso_id,
                        principalTable: "organization_sso",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_organization_sso_organization_id",
                table: "organization_sso",
                column: "organization_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_sso_domains_sso_id_domain",
                table: "sso_domains",
                columns: new[] { "sso_id", "domain" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_sso_domains_verified_domain",
                table: "sso_domains",
                column: "domain",
                unique: true,
                filter: "verified_at IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_sso_link_requests_expires_at",
                table: "sso_link_requests",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "ix_sso_link_requests_organization_id",
                table: "sso_link_requests",
                column: "organization_id");

            migrationBuilder.CreateIndex(
                name: "ix_sso_link_requests_token_hash",
                table: "sso_link_requests",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_sso_link_requests_user_id",
                table: "sso_link_requests",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_sso_login_codes_code_hash",
                table: "sso_login_codes",
                column: "code_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_sso_login_codes_expires_at",
                table: "sso_login_codes",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "ix_sso_login_codes_user_id",
                table: "sso_login_codes",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_sso_login_tickets_expires_at",
                table: "sso_login_tickets",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "ix_sso_login_tickets_organization_id",
                table: "sso_login_tickets",
                column: "organization_id");

            migrationBuilder.CreateIndex(
                name: "ix_sso_login_tickets_state_hash",
                table: "sso_login_tickets",
                column: "state_hash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "sso_domains");

            migrationBuilder.DropTable(
                name: "sso_link_requests");

            migrationBuilder.DropTable(
                name: "sso_login_codes");

            migrationBuilder.DropTable(
                name: "sso_login_tickets");

            migrationBuilder.DropTable(
                name: "organization_sso");
        }
    }
}
