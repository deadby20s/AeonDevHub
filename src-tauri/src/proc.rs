//! Running child processes that may hang (network calls) with a time limit.
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Runs `cmd` to completion or kills it after `timeout`.
/// Returns stdout on success, or stderr (or a timeout message) on failure.
pub fn run(mut cmd: Command, timeout: Duration) -> Result<String, String> {
    crate::launch::no_window(&mut cmd);
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    // Drain both pipes on threads so a chatty process can't block on a full pipe.
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let out_t = std::thread::spawn(move || {
        let mut s = Vec::new();
        let _ = out.read_to_end(&mut s);
        s
    });
    let err_t = std::thread::spawn(move || {
        let mut s = Vec::new();
        let _ = err.read_to_end(&mut s);
        s
    });

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("timed out after {}s", timeout.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(e.to_string()),
        }
    };
    let stdout = String::from_utf8_lossy(&out_t.join().unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&err_t.join().unwrap_or_default()).trim().to_string();
    if status.success() {
        Ok(stdout)
    } else if stderr.is_empty() {
        Err(format!("exited with {status}"))
    } else {
        Err(stderr)
    }
}

/// Runs `f` over `items` on up to `threads` worker threads, calling `progress(done, total)`.
pub fn parallel<T: Sync, R: Send>(
    items: &[T],
    threads: usize,
    f: impl Fn(&T) -> R + Sync,
    progress: &(dyn Fn(usize, usize) + Sync),
) -> Vec<R> {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};
    let total = items.len();
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let results: Mutex<Vec<(usize, R)>> = Mutex::new(Vec::with_capacity(total));
    std::thread::scope(|s| {
        for _ in 0..threads.clamp(1, total.max(1)) {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= total {
                    break;
                }
                let r = f(&items[i]);
                results.lock().unwrap().push((i, r));
                progress(done.fetch_add(1, Ordering::Relaxed) + 1, total);
            });
        }
    });
    let mut v = results.into_inner().unwrap();
    v.sort_by_key(|(i, _)| *i);
    v.into_iter().map(|(_, r)| r).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_out_and_reports_errors() {
        let mut c = Command::new("git");
        c.arg("--version");
        assert!(run(c, Duration::from_secs(10)).unwrap().starts_with("git version"));
        let mut c = Command::new("git");
        c.arg("no-such-command");
        assert!(run(c, Duration::from_secs(10)).is_err());
    }

    #[test]
    fn parallel_keeps_order() {
        let v: Vec<u32> = (0..50).collect();
        assert_eq!(parallel(&v, 4, |x| x * 2, &|_, _| {}), (0..50).map(|x| x * 2).collect::<Vec<_>>());
    }
}
