use serde::{Deserialize, Serialize};
use std::io::Read;
use std::time::Duration;

/// 更新清单地址（TOS 静态 JSON），与 scripts/build_common.py 的 UPDATE_BASE 保持一致。
const UPDATE_MANIFEST_URL: &str =
    "https://qf99.tos-cn-beijing.volces.com/x-reader/update.json";
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub version: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct UpdateCheckResult {
    manifest: Option<UpdateManifest>,
    error: Option<String>,
}

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 拉取远端更新清单。网络请求放在阻塞线程池，避免占用窗口事件循环。
#[tauri::command]
pub async fn check_update() -> UpdateCheckResult {
    tauri::async_runtime::spawn_blocking(check_update_blocking)
        .await
        .unwrap_or_else(|error| failure(format!("检查更新任务失败：{error}")))
}

fn manifest_url() -> String {
    // 仅调试构建允许用环境变量指向本地清单，便于测试；发布版固定使用 TOS。
    if cfg!(debug_assertions) {
        if let Ok(url) = std::env::var("XREADER_UPDATE_URL") {
            let url = url.trim();
            if !url.is_empty() {
                return url.to_string();
            }
        }
    }
    UPDATE_MANIFEST_URL.to_string()
}

fn check_update_blocking() -> UpdateCheckResult {
    let client = match reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(concat!("X-Reader/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(client) => client,
        Err(error) => return failure(format!("无法创建网络请求：{error}")),
    };

    let response = match client.get(manifest_url()).send() {
        Ok(response) => response,
        Err(error) => return failure(format!("无法连接更新服务器：{error}")),
    };
    if !response.status().is_success() {
        return failure(format!(
            "更新服务不可用（HTTP {}）",
            response.status().as_u16()
        ));
    }
    if let Some(length) = response.content_length() {
        if length > MAX_MANIFEST_BYTES {
            return failure("更新信息过大".to_string());
        }
    }

    let mut body = Vec::new();
    if let Err(error) = response
        .take(MAX_MANIFEST_BYTES)
        .read_to_end(&mut body)
    {
        return failure(format!("读取更新信息失败：{error}"));
    }

    match parse_manifest(&body) {
        Ok(manifest) => UpdateCheckResult {
            manifest: Some(manifest),
            error: None,
        },
        Err(error) => failure(error),
    }
}

fn parse_manifest(body: &[u8]) -> Result<UpdateManifest, String> {
    let manifest: UpdateManifest = serde_json::from_slice(body)
        .map_err(|error| format!("更新信息格式错误：{error}"))?;
    if manifest.version.trim().is_empty() {
        return Err("更新信息缺少 version 字段".to_string());
    }
    if let Some(url) = manifest.url.as_deref() {
        if !url.starts_with("https://") {
            return Err("更新地址必须是 https".to_string());
        }
    }
    Ok(manifest)
}

fn failure(message: String) -> UpdateCheckResult {
    UpdateCheckResult {
        manifest: None,
        error: Some(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_update_manifest() {
        let manifest = parse_manifest(
            r#"{
                "version": "0.1.1",
                "date": "2026-11-16",
                "notes": "· 新增 PDF\n· 修复若干问题",
                "url": "https://example.com/X-Reader_0.1.1_x64-setup.exe",
                "sha256": "abc123"
            }"#
            .as_bytes(),
        )
        .unwrap();
        assert_eq!(manifest.version, "0.1.1");
        assert_eq!(manifest.date.as_deref(), Some("2026-11-16"));
        assert!(manifest.notes.unwrap().contains("新增 PDF"));
        assert!(manifest.url.unwrap().starts_with("https://"));
    }

    #[test]
    fn rejects_invalid_update_manifests() {
        assert!(parse_manifest(br#"{"version": ""}"#).is_err());
        assert!(parse_manifest(br#"{"notes": "no version"}"#).is_err());
        assert!(
            parse_manifest(br#"{"version": "0.1.1", "url": "http://example.com/a.exe"}"#)
                .is_err()
        );
        assert!(parse_manifest(b"not-json").is_err());
    }
}
