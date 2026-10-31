using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Apivator.Infrastructure.Persistence.Migrations.Sqlite
{
    /// <inheritdoc />
    public partial class InitialSqlite : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "data_protection_keys",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    friendly_name = table.Column<string>(type: "TEXT", nullable: true),
                    xml = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_data_protection_keys", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "roles",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", maxLength: 256, nullable: true),
                    normalized_name = table.Column<string>(type: "TEXT", maxLength: 256, nullable: true),
                    concurrency_stamp = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_roles", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    display_name = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    pending_email = table.Column<string>(type: "TEXT", maxLength: 256, nullable: true),
                    avatar_version = table.Column<long>(type: "INTEGER", nullable: true),
                    preferences = table.Column<string>(type: "TEXT", nullable: false, defaultValueSql: "'{}'"),
                    deleted_at = table.Column<long>(type: "INTEGER", nullable: true),
                    authenticator_key = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: true),
                    last_totp_step = table.Column<long>(type: "INTEGER", nullable: true),
                    recovery_code_hashes = table.Column<string>(type: "TEXT", nullable: false, defaultValueSql: "'[]'"),
                    two_factor_enabled_at = table.Column<long>(type: "INTEGER", nullable: true),
                    user_name = table.Column<string>(type: "TEXT", maxLength: 256, nullable: true),
                    normalized_user_name = table.Column<string>(type: "TEXT", maxLength: 256, nullable: true),
                    email = table.Column<string>(type: "TEXT", maxLength: 256, nullable: true),
                    normalized_email = table.Column<string>(type: "TEXT", maxLength: 256, nullable: true),
                    email_confirmed = table.Column<bool>(type: "INTEGER", nullable: false),
                    password_hash = table.Column<string>(type: "TEXT", nullable: true),
                    security_stamp = table.Column<string>(type: "TEXT", nullable: true),
                    concurrency_stamp = table.Column<string>(type: "TEXT", nullable: true),
                    phone_number = table.Column<string>(type: "TEXT", nullable: true),
                    phone_number_confirmed = table.Column<bool>(type: "INTEGER", nullable: false),
                    two_factor_enabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    lockout_end = table.Column<long>(type: "INTEGER", nullable: true),
                    lockout_enabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    access_failed_count = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_users", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "role_claims",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    role_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    claim_type = table.Column<string>(type: "TEXT", nullable: true),
                    claim_value = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_role_claims", x => x.id);
                    table.ForeignKey(
                        name: "fk_role_claims_roles_role_id",
                        column: x => x.role_id,
                        principalTable: "roles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "api_keys",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    prefix = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    expires_at = table.Column<long>(type: "INTEGER", nullable: true),
                    last_used_at = table.Column<long>(type: "INTEGER", nullable: true),
                    revoked_at = table.Column<long>(type: "INTEGER", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_api_keys", x => x.id);
                    table.ForeignKey(
                        name: "fk_api_keys_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "organizations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    slug = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    is_personal = table.Column<bool>(type: "INTEGER", nullable: false),
                    owner_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    require_two_factor = table.Column<bool>(type: "INTEGER", nullable: false),
                    default_language = table.Column<string>(type: "TEXT", maxLength: 8, nullable: false, defaultValue: "tr"),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organizations", x => x.id);
                    table.ForeignKey(
                        name: "fk_organizations_users_owner_id",
                        column: x => x.owner_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "refresh_tokens",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    session_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    session_started_at = table.Column<long>(type: "INTEGER", nullable: false),
                    token_hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    expires_at = table.Column<long>(type: "INTEGER", nullable: false),
                    revoked_at = table.Column<long>(type: "INTEGER", nullable: true),
                    replaced_by_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    user_agent = table.Column<string>(type: "TEXT", maxLength: 512, nullable: true),
                    ip_address = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true),
                    app = table.Column<string>(type: "TEXT", maxLength: 20, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_refresh_tokens", x => x.id);
                    table.ForeignKey(
                        name: "fk_refresh_tokens_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "security_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    kind = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    device = table.Column<string>(type: "TEXT", maxLength: 120, nullable: true),
                    ip_address = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true),
                    actor_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    actor_name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    detail = table.Column<string>(type: "TEXT", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_security_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_security_events_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sso_login_codes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    code_hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    organization_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    client_challenge = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    expires_at = table.Column<long>(type: "INTEGER", nullable: false)
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
                name: "user_avatars",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    content_type = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    data = table.Column<byte[]>(type: "BLOB", nullable: false),
                    updated_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_avatars", x => x.user_id);
                    table.ForeignKey(
                        name: "fk_user_avatars_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_claims",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    claim_type = table.Column<string>(type: "TEXT", nullable: true),
                    claim_value = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_claims", x => x.id);
                    table.ForeignKey(
                        name: "fk_user_claims_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_logins",
                columns: table => new
                {
                    login_provider = table.Column<string>(type: "TEXT", nullable: false),
                    provider_key = table.Column<string>(type: "TEXT", nullable: false),
                    provider_display_name = table.Column<string>(type: "TEXT", nullable: true),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_logins", x => new { x.login_provider, x.provider_key });
                    table.ForeignKey(
                        name: "fk_user_logins_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_roles",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    role_id = table.Column<Guid>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_roles", x => new { x.user_id, x.role_id });
                    table.ForeignKey(
                        name: "fk_user_roles_roles_role_id",
                        column: x => x.role_id,
                        principalTable: "roles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_user_roles_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_tokens",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    login_provider = table.Column<string>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", nullable: false),
                    value = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_tokens", x => new { x.user_id, x.login_provider, x.name });
                    table.ForeignKey(
                        name: "fk_user_tokens_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "audit_log",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    organization_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    workspace_name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    action = table.Column<string>(type: "TEXT", maxLength: 60, nullable: false),
                    actor_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    actor_name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    actor_email = table.Column<string>(type: "TEXT", maxLength: 256, nullable: true),
                    api_key_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    ip_address = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true),
                    device = table.Column<string>(type: "TEXT", maxLength: 120, nullable: true),
                    target_type = table.Column<string>(type: "TEXT", maxLength: 60, nullable: false),
                    target_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    target_name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    data = table.Column<string>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_audit_log", x => x.id);
                    table.ForeignKey(
                        name: "fk_audit_log_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "organization_members",
                columns: table => new
                {
                    organization_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    role = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    joined_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organization_members", x => new { x.organization_id, x.user_id });
                    table.ForeignKey(
                        name: "fk_organization_members_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_organization_members_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "organization_sso",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    organization_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    enabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    enforced = table.Column<bool>(type: "INTEGER", nullable: false),
                    authority = table.Column<string>(type: "TEXT", maxLength: 500, nullable: false),
                    client_id = table.Column<string>(type: "TEXT", maxLength: 300, nullable: false),
                    protected_client_secret = table.Column<string>(type: "TEXT", maxLength: 4000, nullable: true),
                    auto_provision = table.Column<bool>(type: "INTEGER", nullable: false),
                    default_role = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    updated_at = table.Column<long>(type: "INTEGER", nullable: false)
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
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    token_hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    organization_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    login_provider = table.Column<string>(type: "TEXT", maxLength: 128, nullable: false),
                    subject = table.Column<string>(type: "TEXT", maxLength: 256, nullable: false),
                    expires_at = table.Column<long>(type: "INTEGER", nullable: false)
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
                name: "sso_login_tickets",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    state_hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    organization_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    protected_code_verifier = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: false),
                    nonce = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    client_challenge = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    return_url = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    client_state = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    expires_at = table.Column<long>(type: "INTEGER", nullable: false)
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
                name: "teams",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    organization_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_teams", x => x.id);
                    table.ForeignKey(
                        name: "fk_teams_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "workspaces",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    organization_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    type = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    created_by_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    globals = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_workspaces", x => x.id);
                    table.ForeignKey(
                        name: "fk_workspaces_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_workspaces_users_created_by_id",
                        column: x => x.created_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "sso_domains",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    sso_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    domain = table.Column<string>(type: "TEXT", maxLength: 253, nullable: false),
                    verification_token = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    verified_at = table.Column<long>(type: "INTEGER", nullable: true),
                    last_checked_at = table.Column<long>(type: "INTEGER", nullable: true),
                    failed_checks = table.Column<int>(type: "INTEGER", nullable: false)
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

            migrationBuilder.CreateTable(
                name: "team_members",
                columns: table => new
                {
                    team_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    joined_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_team_members", x => new { x.team_id, x.user_id });
                    table.ForeignKey(
                        name: "fk_team_members_teams_team_id",
                        column: x => x.team_id,
                        principalTable: "teams",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_team_members_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "change_log",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    target_type = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    target_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    collection_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    target_name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    action = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    detail = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    user_name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    version = table.Column<int>(type: "INTEGER", nullable: true),
                    snapshot = table.Column<string>(type: "TEXT", nullable: true),
                    quiet = table.Column<bool>(type: "INTEGER", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_change_log", x => x.id);
                    table.ForeignKey(
                        name: "fk_change_log_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_change_log_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "collections",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "TEXT", nullable: true),
                    auth = table.Column<string>(type: "TEXT", nullable: false),
                    variables = table.Column<string>(type: "TEXT", nullable: false),
                    scripts = table.Column<string>(type: "TEXT", nullable: false),
                    editing_restricted = table.Column<bool>(type: "INTEGER", nullable: false),
                    created_by_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    updated_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_collections", x => x.id);
                    table.ForeignKey(
                        name: "fk_collections_users_created_by_id",
                        column: x => x.created_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_collections_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "comments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    target_type = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    target_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    parent_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    body = table.Column<string>(type: "TEXT", maxLength: 4000, nullable: false),
                    author_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    edited_at = table.Column<long>(type: "INTEGER", nullable: true),
                    resolved_at = table.Column<long>(type: "INTEGER", nullable: true),
                    resolved_by_id = table.Column<Guid>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_comments", x => x.id);
                    table.ForeignKey(
                        name: "fk_comments_comments_parent_id",
                        column: x => x.parent_id,
                        principalTable: "comments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_comments_users_author_id",
                        column: x => x.author_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_comments_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "environments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    variables = table.Column<string>(type: "TEXT", nullable: false),
                    version = table.Column<int>(type: "INTEGER", nullable: false),
                    created_by_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    updated_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_environments", x => x.id);
                    table.ForeignKey(
                        name: "fk_environments_users_created_by_id",
                        column: x => x.created_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_environments_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "invitations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    organization_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    email = table.Column<string>(type: "TEXT", maxLength: 256, nullable: false),
                    role = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    workspace_role = table.Column<string>(type: "TEXT", maxLength: 20, nullable: true),
                    token_hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    invited_by_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    expires_at = table.Column<long>(type: "INTEGER", nullable: false),
                    accepted_at = table.Column<long>(type: "INTEGER", nullable: true),
                    accepted_by_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    revoked_at = table.Column<long>(type: "INTEGER", nullable: true),
                    language = table.Column<string>(type: "TEXT", maxLength: 8, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_invitations", x => x.id);
                    table.ForeignKey(
                        name: "fk_invitations_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_invitations_users_invited_by_id",
                        column: x => x.invited_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_invitations_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "workspace_members",
                columns: table => new
                {
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    role = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    joined_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_workspace_members", x => new { x.workspace_id, x.user_id });
                    table.ForeignKey(
                        name: "fk_workspace_members_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_workspace_members_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "workspace_teams",
                columns: table => new
                {
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    team_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    role = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_workspace_teams", x => new { x.workspace_id, x.team_id });
                    table.ForeignKey(
                        name: "fk_workspace_teams_teams_team_id",
                        column: x => x.team_id,
                        principalTable: "teams",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_workspace_teams_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "collection_access",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    team_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    role = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    created_by_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_collection_access", x => x.id);
                    table.CheckConstraint("ck_collection_access_subject", "(user_id IS NULL) <> (team_id IS NULL)");
                    table.ForeignKey(
                        name: "fk_collection_access_collections_collection_id",
                        column: x => x.collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_collection_access_teams_team_id",
                        column: x => x.team_id,
                        principalTable: "teams",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_collection_access_users_created_by_id",
                        column: x => x.created_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_collection_access_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "collection_forks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    fork_collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    source_collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    created_by_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    last_pulled_at = table.Column<long>(type: "INTEGER", nullable: true)
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
                name: "collection_git_syncs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    remote_url = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: false),
                    branch = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    folder_path = table.Column<string>(type: "TEXT", maxLength: 300, nullable: false),
                    username = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    protected_token = table.Column<string>(type: "TEXT", maxLength: 8000, nullable: true),
                    base_snapshot = table.Column<string>(type: "TEXT", nullable: false),
                    last_commit = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true),
                    last_synced_at = table.Column<long>(type: "INTEGER", nullable: true),
                    last_synced_by_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    remote_head = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true),
                    behind = table.Column<int>(type: "INTEGER", nullable: false),
                    last_checked_at = table.Column<long>(type: "INTEGER", nullable: true),
                    last_error = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    connected_by_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    connected_at = table.Column<long>(type: "INTEGER", nullable: false),
                    check_interval_hours = table.Column<int>(type: "INTEGER", nullable: true),
                    next_check_at = table.Column<long>(type: "INTEGER", nullable: true),
                    locked_until = table.Column<long>(type: "INTEGER", nullable: true),
                    consecutive_failures = table.Column<int>(type: "INTEGER", nullable: false)
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

            migrationBuilder.CreateTable(
                name: "collection_sources",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    url = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: false),
                    local = table.Column<bool>(type: "INTEGER", nullable: false),
                    document = table.Column<string>(type: "TEXT", nullable: false),
                    document_hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    document_version = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    imported_at = table.Column<long>(type: "INTEGER", nullable: false),
                    updated_at = table.Column<long>(type: "INTEGER", nullable: false),
                    updated_by_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    pending_document = table.Column<string>(type: "TEXT", nullable: true),
                    pending_hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true),
                    check_interval_hours = table.Column<int>(type: "INTEGER", nullable: true),
                    check_owner_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    next_check_at = table.Column<long>(type: "INTEGER", nullable: true),
                    locked_until = table.Column<long>(type: "INTEGER", nullable: true),
                    last_checked_at = table.Column<long>(type: "INTEGER", nullable: true),
                    last_check_error = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    change_detected_at = table.Column<long>(type: "INTEGER", nullable: true),
                    notified_hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true)
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

            migrationBuilder.CreateTable(
                name: "folders",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    parent_folder_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    name = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "TEXT", nullable: true),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false),
                    auth = table.Column<string>(type: "TEXT", nullable: false),
                    scripts = table.Column<string>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_folders", x => x.id);
                    table.ForeignKey(
                        name: "fk_folders_collections_collection_id",
                        column: x => x.collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_folders_folders_parent_folder_id",
                        column: x => x.parent_folder_id,
                        principalTable: "folders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "notifications",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    kind = table.Column<string>(type: "TEXT", maxLength: 30, nullable: false),
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    comment_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    target_type = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    target_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    target_name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    actor_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    actor_name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    preview = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    read_at = table.Column<long>(type: "INTEGER", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notifications", x => x.id);
                    table.ForeignKey(
                        name: "fk_notifications_comments_comment_id",
                        column: x => x.comment_id,
                        principalTable: "comments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_notifications_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_notifications_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "collection_monitors",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    environment_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    name = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    schedule = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    time_zone = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    enabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    notify_emails = table.Column<string>(type: "TEXT", nullable: false),
                    webhook_url = table.Column<string>(type: "TEXT", maxLength: 2048, nullable: true),
                    webhook_kind = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    notify_mode = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    created_by_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    updated_at = table.Column<long>(type: "INTEGER", nullable: false),
                    next_run_at = table.Column<long>(type: "INTEGER", nullable: true),
                    last_run_at = table.Column<long>(type: "INTEGER", nullable: true),
                    last_run_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    health = table.Column<string>(type: "TEXT", maxLength: 20, nullable: true),
                    consecutive_failures = table.Column<int>(type: "INTEGER", nullable: false),
                    last_error = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    locked_until = table.Column<long>(type: "INTEGER", nullable: true)
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

            migrationBuilder.CreateTable(
                name: "mock_servers",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    environment_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    name = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    key = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
                    is_private = table.Column<bool>(type: "INTEGER", nullable: false),
                    delay_ms = table.Column<int>(type: "INTEGER", nullable: false),
                    enabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    created_by_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    updated_at = table.Column<long>(type: "INTEGER", nullable: false)
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
                name: "published_docs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    slug = table.Column<string>(type: "TEXT", maxLength: 14, nullable: false),
                    visibility = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    environment_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    published_by_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    updated_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_published_docs", x => x.id);
                    table.ForeignKey(
                        name: "fk_published_docs_collections_collection_id",
                        column: x => x.collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_published_docs_environments_environment_id",
                        column: x => x.environment_id,
                        principalTable: "environments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "fork_links",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    fork_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    kind = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    source_item_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    fork_item_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    @base = table.Column<string>(name: "base", type: "TEXT", nullable: false)
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
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    fork_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    source_collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    fork_collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    title = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "TEXT", maxLength: 10000, nullable: true),
                    status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    author_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    approvals = table.Column<string>(type: "TEXT", nullable: false),
                    merged_changes = table.Column<string>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    updated_at = table.Column<long>(type: "INTEGER", nullable: false),
                    closed_at = table.Column<long>(type: "INTEGER", nullable: true),
                    closed_by_id = table.Column<Guid>(type: "TEXT", nullable: true)
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

            migrationBuilder.CreateTable(
                name: "requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    folder_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false),
                    definition = table.Column<string>(type: "TEXT", nullable: false),
                    method = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    kind = table.Column<string>(type: "TEXT", maxLength: 12, nullable: false),
                    source_key = table.Column<string>(type: "TEXT", maxLength: 600, nullable: true),
                    version = table.Column<int>(type: "INTEGER", nullable: false),
                    updated_by_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    updated_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_requests", x => x.id);
                    table.ForeignKey(
                        name: "fk_requests_collections_collection_id",
                        column: x => x.collection_id,
                        principalTable: "collections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_requests_folders_folder_id",
                        column: x => x.folder_id,
                        principalTable: "folders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_requests_users_updated_by_id",
                        column: x => x.updated_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "collection_runs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    collection_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    folder_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", maxLength: 250, nullable: false),
                    environment_name = table.Column<string>(type: "TEXT", maxLength: 120, nullable: true),
                    iterations = table.Column<int>(type: "INTEGER", nullable: false),
                    delay_ms = table.Column<int>(type: "INTEGER", nullable: false),
                    status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    origin = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    monitor_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    started_at = table.Column<long>(type: "INTEGER", nullable: false),
                    finished_at = table.Column<long>(type: "INTEGER", nullable: false),
                    total_requests = table.Column<int>(type: "INTEGER", nullable: false),
                    failed_requests = table.Column<int>(type: "INTEGER", nullable: false),
                    request_errors = table.Column<int>(type: "INTEGER", nullable: false),
                    tests_passed = table.Column<int>(type: "INTEGER", nullable: false),
                    tests_failed = table.Column<int>(type: "INTEGER", nullable: false),
                    tests_skipped = table.Column<int>(type: "INTEGER", nullable: false),
                    total_time_ms = table.Column<double>(type: "REAL", nullable: false),
                    results = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_collection_runs", x => x.id);
                    table.ForeignKey(
                        name: "fk_collection_runs_collection_monitors_monitor_id",
                        column: x => x.monitor_id,
                        principalTable: "collection_monitors",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
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

            migrationBuilder.CreateTable(
                name: "mock_calls",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    mock_server_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    at = table.Column<long>(type: "INTEGER", nullable: false),
                    method = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    path = table.Column<string>(type: "TEXT", maxLength: 2048, nullable: false),
                    request_headers = table.Column<string>(type: "TEXT", nullable: false),
                    request_body = table.Column<string>(type: "TEXT", nullable: false),
                    status = table.Column<int>(type: "INTEGER", nullable: false),
                    example_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    matched_name = table.Column<string>(type: "TEXT", maxLength: 420, nullable: true),
                    error = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    duration_ms = table.Column<int>(type: "INTEGER", nullable: false)
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

            migrationBuilder.CreateTable(
                name: "request_history",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    user_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    request_id = table.Column<Guid>(type: "TEXT", nullable: true),
                    method = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    url = table.Column<string>(type: "TEXT", maxLength: 2048, nullable: false),
                    definition = table.Column<string>(type: "TEXT", nullable: false),
                    status = table.Column<int>(type: "INTEGER", nullable: true),
                    time_ms = table.Column<double>(type: "REAL", nullable: true),
                    size = table.Column<long>(type: "INTEGER", nullable: true),
                    executed_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_request_history", x => x.id);
                    table.ForeignKey(
                        name: "fk_request_history_requests_request_id",
                        column: x => x.request_id,
                        principalTable: "requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_request_history_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_request_history_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "response_examples",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "TEXT", nullable: false),
                    request_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    status = table.Column<int>(type: "INTEGER", nullable: false),
                    headers = table.Column<string>(type: "TEXT", nullable: false),
                    body = table.Column<string>(type: "TEXT", nullable: false),
                    request = table.Column<string>(type: "TEXT", nullable: false),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false),
                    created_at = table.Column<long>(type: "INTEGER", nullable: false),
                    updated_at = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_response_examples", x => x.id);
                    table.ForeignKey(
                        name: "fk_response_examples_requests_request_id",
                        column: x => x.request_id,
                        principalTable: "requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "request_history_responses",
                columns: table => new
                {
                    history_entry_id = table.Column<Guid>(type: "TEXT", nullable: false),
                    body = table.Column<string>(type: "TEXT", nullable: false),
                    content_type = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    truncated = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_request_history_responses", x => x.history_entry_id);
                    table.ForeignKey(
                        name: "fk_request_history_responses_request_history_history_entry_id",
                        column: x => x.history_entry_id,
                        principalTable: "request_history",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_api_keys_hash",
                table: "api_keys",
                column: "hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_api_keys_user_id",
                table: "api_keys",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_audit_log_created_at",
                table: "audit_log",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "ix_audit_log_organization_id_action",
                table: "audit_log",
                columns: new[] { "organization_id", "action" });

            migrationBuilder.CreateIndex(
                name: "ix_audit_log_organization_id_created_at_id",
                table: "audit_log",
                columns: new[] { "organization_id", "created_at", "id" });

            migrationBuilder.CreateIndex(
                name: "ix_change_log_target_id_created_at",
                table: "change_log",
                columns: new[] { "target_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_change_log_user_id",
                table: "change_log",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_change_log_workspace_id_created_at",
                table: "change_log",
                columns: new[] { "workspace_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_collection_access_collection_id_team_id",
                table: "collection_access",
                columns: new[] { "collection_id", "team_id" },
                unique: true,
                filter: "team_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_collection_access_collection_id_user_id",
                table: "collection_access",
                columns: new[] { "collection_id", "user_id" },
                unique: true,
                filter: "user_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_collection_access_created_by_id",
                table: "collection_access",
                column: "created_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_collection_access_team_id",
                table: "collection_access",
                column: "team_id");

            migrationBuilder.CreateIndex(
                name: "ix_collection_access_user_id",
                table: "collection_access",
                column: "user_id");

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

            migrationBuilder.CreateIndex(
                name: "ix_collection_runs_collection_id_started_at",
                table: "collection_runs",
                columns: new[] { "collection_id", "started_at" });

            migrationBuilder.CreateIndex(
                name: "ix_collection_runs_monitor_id_started_at",
                table: "collection_runs",
                columns: new[] { "monitor_id", "started_at" });

            migrationBuilder.CreateIndex(
                name: "ix_collection_runs_user_id",
                table: "collection_runs",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_collection_runs_workspace_id_started_at",
                table: "collection_runs",
                columns: new[] { "workspace_id", "started_at" });

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

            migrationBuilder.CreateIndex(
                name: "ix_collections_created_by_id",
                table: "collections",
                column: "created_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_collections_workspace_id",
                table: "collections",
                column: "workspace_id");

            migrationBuilder.CreateIndex(
                name: "ix_comments_author_id",
                table: "comments",
                column: "author_id");

            migrationBuilder.CreateIndex(
                name: "ix_comments_parent_id",
                table: "comments",
                column: "parent_id");

            migrationBuilder.CreateIndex(
                name: "ix_comments_target_id_created_at",
                table: "comments",
                columns: new[] { "target_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_comments_workspace_id",
                table: "comments",
                column: "workspace_id");

            migrationBuilder.CreateIndex(
                name: "ix_environments_created_by_id",
                table: "environments",
                column: "created_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_environments_workspace_id",
                table: "environments",
                column: "workspace_id");

            migrationBuilder.CreateIndex(
                name: "ix_folders_collection_id",
                table: "folders",
                column: "collection_id");

            migrationBuilder.CreateIndex(
                name: "ix_folders_parent_folder_id",
                table: "folders",
                column: "parent_folder_id");

            migrationBuilder.CreateIndex(
                name: "ix_fork_links_fork_id",
                table: "fork_links",
                column: "fork_id");

            migrationBuilder.CreateIndex(
                name: "ix_invitations_email",
                table: "invitations",
                column: "email");

            migrationBuilder.CreateIndex(
                name: "ix_invitations_invited_by_id",
                table: "invitations",
                column: "invited_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_invitations_organization_id_email",
                table: "invitations",
                columns: new[] { "organization_id", "email" });

            migrationBuilder.CreateIndex(
                name: "ix_invitations_token_hash",
                table: "invitations",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_invitations_workspace_id",
                table: "invitations",
                column: "workspace_id");

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

            migrationBuilder.CreateIndex(
                name: "ix_notifications_comment_id",
                table: "notifications",
                column: "comment_id");

            migrationBuilder.CreateIndex(
                name: "ix_notifications_user_id_created_at",
                table: "notifications",
                columns: new[] { "user_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notifications_workspace_id",
                table: "notifications",
                column: "workspace_id");

            migrationBuilder.CreateIndex(
                name: "ix_organization_members_user_id",
                table: "organization_members",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_organization_sso_organization_id",
                table: "organization_sso",
                column: "organization_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_organizations_owner_id",
                table: "organizations",
                column: "owner_id");

            migrationBuilder.CreateIndex(
                name: "ix_organizations_slug",
                table: "organizations",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_published_docs_collection_id",
                table: "published_docs",
                column: "collection_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_published_docs_environment_id",
                table: "published_docs",
                column: "environment_id");

            migrationBuilder.CreateIndex(
                name: "ix_published_docs_slug",
                table: "published_docs",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_refresh_tokens_session_id",
                table: "refresh_tokens",
                column: "session_id");

            migrationBuilder.CreateIndex(
                name: "ix_refresh_tokens_token_hash",
                table: "refresh_tokens",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_refresh_tokens_user_id",
                table: "refresh_tokens",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_request_history_request_id",
                table: "request_history",
                column: "request_id");

            migrationBuilder.CreateIndex(
                name: "ix_request_history_user_id_workspace_id_executed_at",
                table: "request_history",
                columns: new[] { "user_id", "workspace_id", "executed_at" });

            migrationBuilder.CreateIndex(
                name: "ix_request_history_workspace_id",
                table: "request_history",
                column: "workspace_id");

            migrationBuilder.CreateIndex(
                name: "ix_requests_collection_id",
                table: "requests",
                column: "collection_id");

            migrationBuilder.CreateIndex(
                name: "ix_requests_folder_id",
                table: "requests",
                column: "folder_id");

            migrationBuilder.CreateIndex(
                name: "ix_requests_updated_by_id",
                table: "requests",
                column: "updated_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_response_examples_request_id",
                table: "response_examples",
                column: "request_id");

            migrationBuilder.CreateIndex(
                name: "ix_role_claims_role_id",
                table: "role_claims",
                column: "role_id");

            migrationBuilder.CreateIndex(
                name: "role_name_index",
                table: "roles",
                column: "normalized_name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_security_events_user_id_created_at",
                table: "security_events",
                columns: new[] { "user_id", "created_at" });

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

            migrationBuilder.CreateIndex(
                name: "ix_team_members_user_id",
                table: "team_members",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_teams_organization_id_name",
                table: "teams",
                columns: new[] { "organization_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_user_claims_user_id",
                table: "user_claims",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_user_logins_user_id",
                table: "user_logins",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_user_roles_role_id",
                table: "user_roles",
                column: "role_id");

            migrationBuilder.CreateIndex(
                name: "email_index",
                table: "users",
                column: "normalized_email");

            migrationBuilder.CreateIndex(
                name: "user_name_index",
                table: "users",
                column: "normalized_user_name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_workspace_members_user_id",
                table: "workspace_members",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_workspace_teams_team_id",
                table: "workspace_teams",
                column: "team_id");

            migrationBuilder.CreateIndex(
                name: "ix_workspaces_created_by_id",
                table: "workspaces",
                column: "created_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_workspaces_organization_id",
                table: "workspaces",
                column: "organization_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "api_keys");

            migrationBuilder.DropTable(
                name: "audit_log");

            migrationBuilder.DropTable(
                name: "change_log");

            migrationBuilder.DropTable(
                name: "collection_access");

            migrationBuilder.DropTable(
                name: "collection_git_syncs");

            migrationBuilder.DropTable(
                name: "collection_runs");

            migrationBuilder.DropTable(
                name: "collection_sources");

            migrationBuilder.DropTable(
                name: "data_protection_keys");

            migrationBuilder.DropTable(
                name: "fork_links");

            migrationBuilder.DropTable(
                name: "invitations");

            migrationBuilder.DropTable(
                name: "merge_requests");

            migrationBuilder.DropTable(
                name: "mock_calls");

            migrationBuilder.DropTable(
                name: "notifications");

            migrationBuilder.DropTable(
                name: "organization_members");

            migrationBuilder.DropTable(
                name: "published_docs");

            migrationBuilder.DropTable(
                name: "refresh_tokens");

            migrationBuilder.DropTable(
                name: "request_history_responses");

            migrationBuilder.DropTable(
                name: "response_examples");

            migrationBuilder.DropTable(
                name: "role_claims");

            migrationBuilder.DropTable(
                name: "security_events");

            migrationBuilder.DropTable(
                name: "sso_domains");

            migrationBuilder.DropTable(
                name: "sso_link_requests");

            migrationBuilder.DropTable(
                name: "sso_login_codes");

            migrationBuilder.DropTable(
                name: "sso_login_tickets");

            migrationBuilder.DropTable(
                name: "team_members");

            migrationBuilder.DropTable(
                name: "user_avatars");

            migrationBuilder.DropTable(
                name: "user_claims");

            migrationBuilder.DropTable(
                name: "user_logins");

            migrationBuilder.DropTable(
                name: "user_roles");

            migrationBuilder.DropTable(
                name: "user_tokens");

            migrationBuilder.DropTable(
                name: "workspace_members");

            migrationBuilder.DropTable(
                name: "workspace_teams");

            migrationBuilder.DropTable(
                name: "collection_monitors");

            migrationBuilder.DropTable(
                name: "collection_forks");

            migrationBuilder.DropTable(
                name: "mock_servers");

            migrationBuilder.DropTable(
                name: "comments");

            migrationBuilder.DropTable(
                name: "request_history");

            migrationBuilder.DropTable(
                name: "organization_sso");

            migrationBuilder.DropTable(
                name: "roles");

            migrationBuilder.DropTable(
                name: "teams");

            migrationBuilder.DropTable(
                name: "environments");

            migrationBuilder.DropTable(
                name: "requests");

            migrationBuilder.DropTable(
                name: "folders");

            migrationBuilder.DropTable(
                name: "collections");

            migrationBuilder.DropTable(
                name: "workspaces");

            migrationBuilder.DropTable(
                name: "organizations");

            migrationBuilder.DropTable(
                name: "users");
        }
    }
}
