//! VOXEL — Rust core.
//!
//! Security authority of the application: every filesystem, process and
//! secret operation goes through commands declared here. The frontend
//! never touches the system directly.

mod commands;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

pub fn run() {
    let migrations = vec![
        // v1 — initial schema (18 tables)
        Migration {
            version: 1,
            description: "initial_schema",
            sql: include_str!("migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        // v2 — Minecraft Version Catalog cache (auto-updating)
        Migration {
            version: 2,
            description: "version_catalog_columns",
            sql: include_str!("migrations/002_version_catalog.sql"),
            kind: MigrationKind::Up,
        },
        // v3 — Phase C: AI task queue + model metrics (AI Command Center)
        Migration {
            version: 3,
            description: "task_queue_and_ai_metrics",
            sql: include_str!("migrations/003_task_queue.sql"),
            kind: MigrationKind::Up,
        },
        // v4 — Phase D: Player Management punishment history
        Migration {
            version: 4,
            description: "player management punishment history",
            sql: include_str!("migrations/004_player_management.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:nexuscraft.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::environment::detect_environment,
            commands::storage::get_default_storage_base,
            commands::storage::ensure_storage_dirs,
            commands::storage::get_app_paths,
            commands::storage::workspace_migrate_legacy,
            commands::storage::workspace_legacy_status,
            commands::storage::open_in_file_manager,
            commands::storage::workspace_export_snapshot,
            commands::storage::workspace_import_snapshot,
            commands::storage::snapshot_auto_check,
            commands::storage::open_auth_url,
            commands::secrets::secrets_set,
            commands::secrets::secrets_get,
            commands::secrets::secrets_has,
            commands::secrets::secrets_delete,
            commands::secrets::secrets_clear_all,
            commands::secrets::secrets_backend_info,
            commands::projects::create_project,
            commands::projects::project_delete,
            commands::fs::list_project_files,
            commands::fs::read_project_file,
            commands::fs::write_project_file,
            commands::fs::create_project_directory,
            commands::fs::delete_project_entry,
            commands::fs::rename_project_entry,
            commands::fs::read_project_file_base64,
            commands::fs::import_project_file,
            commands::fs::edit_project_file,
            commands::fs::search_project,
            commands::fs::search_workspace,
            commands::git::project_create_snapshot,
            commands::git::project_list_snapshots,
            commands::git::project_snapshot_restore,
            commands::git::project_git_status,
            commands::git::project_git_diff,
            commands::process::start_build,
            commands::process::stop_build,
            commands::process::stop_process,
            commands::launcher::launcher_prepare,
            commands::launcher::launcher_copy_mod_jar,
            commands::launcher::launcher_launch,
            commands::launcher::launcher_overview,
            commands::assets::generate_item_texture,
            commands::modpack::modpack_export,
            commands::modpack::modpack_exportable_assets,
            commands::modpack::modpack_check_compatibility,
            commands::modpack::modpack_list,
            commands::modpack::modpack_delete,
            commands::modpack::modpack_update_manifest,
            commands::modrinth::modrinth_download,
            commands::structures::structure_generate,
            commands::worldgen::worldgen_create_dimension,
            commands::modpack::modpack_import_into,
            commands::servers::server_create,
            commands::servers::servers_scan_disk,
            commands::diagnostics::diagnostics_run,
            commands::documents::documents_extract,
            commands::documents::documents_write,
            commands::dossier::server_generate_dossier,
            commands::dossier::dossier_save_copy,
            commands::fx::fx_latest,
            commands::servers::server_import_world,
            commands::servers::server_import_structure,
            commands::servers::server_update_metadata,
            commands::servers::server_write_info,
            commands::servers::project_deploy_datapack,
            commands::servers::server_start,
            commands::servers::server_stop,
            commands::servers::server_status,
            commands::servers::server_send_command,
            commands::servers::server_players_read,
            commands::servers::server_log_tail,
            commands::servers::server_backup,
            commands::servers::server_list_backups,
            commands::servers::server_backups_config_get,
            commands::servers::server_backups_config_set,
            commands::servers::server_backup_delete,
            commands::servers::server_backup_verify,
            commands::servers::server_backup_prune,
            commands::servers::server_restore,
            commands::servers::server_delete,
            commands::github::git_commit_all,
            commands::github::git_push_github,
            commands::ledger::ledger_init,
            commands::ledger::ledger_apply,
            commands::ledger::ledger_list,
            commands::ledger::ledger_verify,
            commands::ledger::ledger_tail_intents,
            commands::tunnel::tunnel_setup,
            commands::tunnel::tunnel_start,
            commands::tunnel::tunnel_stop,
            commands::tunnel::tunnel_force_stop,
            commands::tunnel::tunnel_status,
            commands::shaders::shaders_create_pack,
            commands::shaders::shaders_list_packs,
            commands::shaders::shaders_delete_pack,
            commands::shaders::shaders_install_pack,
            commands::shaders::shaders_list_instances,
            commands::serverping::server_ping,
            commands::bridge::bridge_start,
            commands::bridge::bridge_stop,
            commands::bridge::bridge_status,
            commands::bridge::bridge_set_ai_config,
        ])
        .setup(|app| {
            // Ensure the app-config dir exists before the SQL plugin tries to
            // open the database (SQLite needs an existing parent directory).
            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running VOXEL");
}
