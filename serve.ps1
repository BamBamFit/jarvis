# Tiny local web server for JARVIS (no installs needed). Usage: right-click > Run with PowerShell,
# or double-click start-jarvis.bat. Then open http://localhost:8777
param([int]$Port = 8777)
$root = $PSScriptRoot
$types = @{ ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8";
  ".svg"="image/svg+xml"; ".json"="application/json"; ".webmanifest"="application/manifest+json"; ".png"="image/png"; ".md"="text/plain; charset=utf-8" }
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "J.A.R.V.I.S. online at http://localhost:$Port  (Ctrl+C to stop)"
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart("/"))
    if ($path -eq "") { $path = "index.html" }
    $file = [System.IO.Path]::GetFullPath((Join-Path $root $path))
    $res = $ctx.Response
    if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" }
      $res.Headers.Add("Cache-Control", "no-cache")
      $res.ContentLength64 = $bytes.Length
      try { $res.OutputStream.Write($bytes, 0, $bytes.Length) } catch { }
    } else { $res.StatusCode = 404 }
    try { $res.Close() } catch { }
  }
} finally { $listener.Stop() }
