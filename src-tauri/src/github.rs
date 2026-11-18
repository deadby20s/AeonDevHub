//! Open pull requests and latest CI run per repo, via the GitHub CLI (`gh`).
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub draft: bool,
    pub author: String,
    pub branch: String,
    /// APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or empty.
    pub review: String,
    /// You are asked to review it.
    pub review_requested: bool,
    /// You opened it.
    pub mine: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CiRun {
    pub name: String,
    /// queued, in_progress, completed…
    pub status: String,
    /// success, failure, cancelled… (empty while running)
    pub conclusion: String,
    pub url: String,
    pub branch: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GithubInfo {
    pub prs: Vec<PullRequest>,
    pub ci: Option<CiRun>,
    pub error: Option<String>,
    pub fetched_at: i64,
}

fn gh_path() -> Option<&'static PathBuf> {
    static GH: OnceLock<Option<PathBuf>> = OnceLock::new();
    GH.get_or_init(|| crate::launch::find_exe("gh")).as_ref()
}

pub fn available() -> bool {
    gh_path().is_some()
}

fn gh(dir: &Path, args: &[&str]) -> Result<String, String> {
    let exe = gh_path().ok_or("The GitHub CLI (gh) is not installed.")?;
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .current_dir(dir)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("NO_COLOR", "1");
    crate::proc::run(cmd, Duration::from_secs(30))
}

/// The signed-in GitHub user, looked up once.
fn me(dir: &Path) -> Option<String> {
    static ME: OnceLock<Option<String>> = OnceLock::new();
    ME.get_or_init(|| gh(dir, &["api", "user", "--jq", ".login"]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
        .clone()
}

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn parse_prs(json: &str, me: Option<&str>) -> Result<Vec<PullRequest>, String> {
    let v: Vec<Value> = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(v.iter()
        .map(|p| {
            let author = p.get("author").map(|a| s(a, "login")).unwrap_or_default();
            let requested = p
                .get("reviewRequests")
                .and_then(Value::as_array)
                .is_some_and(|r| r.iter().any(|x| me.is_some_and(|m| s(x, "login").eq_ignore_ascii_case(m))));
            PullRequest {
                number: p.get("number").and_then(Value::as_u64).unwrap_or(0),
                title: s(p, "title"),
                url: s(p, "url"),
                draft: p.get("isDraft").and_then(Value::as_bool).unwrap_or(false),
                branch: s(p, "headRefName"),
                review: s(p, "reviewDecision"),
                review_requested: requested,
                mine: me.is_some_and(|m| author.eq_ignore_ascii_case(m)),
                author,
            }
        })
        .collect())
}

fn parse_run(json: &str) -> Option<CiRun> {
    let v: Vec<Value> = serde_json::from_str(json).ok()?;
    let r = v.first()?;
    Some(CiRun {
        name: s(r, "workflowName"),
        status: s(r, "status"),
        conclusion: s(r, "conclusion"),
        url: s(r, "url"),
        branch: s(r, "headBranch"),
        created_at: s(r, "createdAt"),
    })
}

pub fn info(dir: &Path, branch: Option<&str>) -> GithubInfo {
    let mut out = GithubInfo { fetched_at: crate::now(), ..Default::default() };
    let me = me(dir);
    match gh(dir, &["pr", "list", "--state", "open", "--limit", "30", "--json", "number,title,url,isDraft,author,headRefName,reviewDecision,reviewRequests"]) {
        Ok(json) => match parse_prs(&json, me.as_deref()) {
            Ok(prs) => out.prs = prs,
            Err(e) => out.error = Some(e),
        },
        Err(e) => {
            out.error = Some(e.lines().next().unwrap_or("gh failed").to_string());
            return out;
        }
    }
    let mut args = vec!["run", "list", "--limit", "1", "--json", "workflowName,status,conclusion,url,headBranch,createdAt"];
    if let Some(b) = branch {
        args.extend(["--branch", b]);
    }
    if let Ok(json) = gh(dir, &args) {
        out.ci = parse_run(&json);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gh_json() {
        let prs = r#"[{"number":7,"title":"Add x","url":"https://github.com/a/b/pull/7","isDraft":false,
            "author":{"login":"Dev"},"headRefName":"feat/x","reviewDecision":"REVIEW_REQUIRED",
            "reviewRequests":[{"__typename":"User","login":"me"}]}]"#;
        let p = parse_prs(prs, Some("ME")).unwrap();
        assert_eq!(p[0].number, 7);
        assert!(p[0].review_requested && !p[0].mine);
        assert_eq!(p[0].branch, "feat/x");
        let run = parse_run(r#"[{"workflowName":"CI","status":"completed","conclusion":"failure","url":"u","headBranch":"main","createdAt":"t"}]"#).unwrap();
        assert_eq!((run.name.as_str(), run.conclusion.as_str()), ("CI", "failure"));
        assert!(parse_run("[]").is_none());
    }
}
