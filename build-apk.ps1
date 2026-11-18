# Build APK AirSense di laptop sendiri (tanpa EAS, tanpa kuota build).
#
#   Pakai:   powershell -ExecutionPolicy Bypass -File .\build-apk.ps1
#   Opsi:    -Prebuild   paksa buat ulang folder android
#            -Clean      hapus salinan build dan mulai dari nol (lama, seperti build pertama)
#            -Emulator   sertakan juga kode x86_64 agar jalan mulus di emulator Android Studio
#                        (APK lebih besar; tetap bisa dipasang di HP biasa)
#
# Hasil:     dist\AirSense.apk
#
# Kenapa disalin dulu: folder project ini berspasi dan path-nya panjang, sehingga build
# native Android gagal (batas 260 karakter Windows). Skrip menyalin project ke C:\asb
# lalu merakit dari sana. Kode tetap diedit di folder ini; C:\asb hanya salinan kerja.
#
# Tanda tangan APK: memakai credentials.json + credentials\android\keystore.jks (kunci yang
# sama dengan build EAS). Diunduh dengan:
#   eas credentials -p android -> preview -> credentials.json
#     -> Download credentials from EAS to credentials.json
# Tanpa file itu APK ditandatangani kunci debug: TIDAK bisa menimpa aplikasi yang sudah
# terpasang dan login Google akan gagal.
param(
  [switch]$Prebuild,
  [switch]$Clean,
  [switch]$Emulator
)
$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$build = "C:\asb"

$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NODE_ENV = "production"
$env:CI = "1"
if (-not (Test-Path "$env:JAVA_HOME\bin\java.exe")) { throw "Java Android Studio tidak ditemukan di $env:JAVA_HOME" }
if (-not (Test-Path "$env:ANDROID_HOME\platform-tools")) { throw "Android SDK tidak ditemukan di $env:ANDROID_HOME" }

function Step($text) { Write-Host "== $text ==" -ForegroundColor Cyan }

if ($Clean -and (Test-Path $build)) {
  Step "Menghapus salinan build lama ($build)"
  cmd /c "rmdir /s /q `"$build`""
}

# 1. Salin sumber (cermin persis, kecuali folder yang tidak dibutuhkan untuk merakit APK)
Step "Menyalin project ke $build"
$skipDirs = @("node_modules", "android", "ios", ".git", ".expo", "dist", "Claude outputs",
  "wearable-alert-api", "vercel-proxy", "functions", "credentials") | ForEach-Object { "$project\$_" }
robocopy $project $build /MIR /XD @skipDirs /XF credentials.json *.apk /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Gagal menyalin project (robocopy $LASTEXITCODE)" }

# 2. Salin node_modules (hanya yang baru/berubah; hasil build di salinan tidak disentuh)
robocopy "$project\node_modules" "$build\node_modules" /E /XD .cxx /MT:16 /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Gagal menyalin node_modules (robocopy $LASTEXITCODE)" }

# 3. Folder android dibuat ulang bila konfigurasi native berubah (app.json, plugin, library)
$nativeInputs = @("$project\app.json", "$project\app.config.js", "$project\package.json", "$project\google-services.json")
$nativeInputs += Get-ChildItem "$project\plugins" -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
$hash = ($nativeInputs | Where-Object { Test-Path $_ } | ForEach-Object { (Get-FileHash $_ -Algorithm SHA1).Hash }) -join ""
$hashFile = "$build\.prebuild-hash"
$oldHash = if (Test-Path $hashFile) { Get-Content -Raw $hashFile } else { "" }
Set-Location $build
if ($Prebuild -or -not (Test-Path "$build\android\gradlew.bat") -or $oldHash.Trim() -ne $hash) {
  Step "Membuat folder android (expo prebuild)"
  cmd /c "npx expo prebuild --platform android --clean"
  if ($LASTEXITCODE -ne 0) { throw "expo prebuild gagal" }
  Set-Content -Path $hashFile -Value $hash -Encoding ascii
}

# 4. Tanda tangan
$architectures = if ($Emulator) { "arm64-v8a,armeabi-v7a,x86_64" } else { "arm64-v8a,armeabi-v7a" }
$gradleArgs = @("assembleRelease", "-PreactNativeArchitectures=$architectures", "--console=plain")
$credentials = "$project\credentials.json"
if (Test-Path $credentials) {
  $keystore = (Get-Content -Raw $credentials | ConvertFrom-Json).android.keystore
  $storeFile = $keystore.keystorePath
  if (-not [System.IO.Path]::IsPathRooted($storeFile)) { $storeFile = Join-Path $project $storeFile }
  if (-not (Test-Path $storeFile)) { throw "File keystore tidak ditemukan: $storeFile" }
  $gradleArgs += @(
    "-Pandroid.injected.signing.store.file=$storeFile",
    "-Pandroid.injected.signing.store.password=$($keystore.keystorePassword)",
    "-Pandroid.injected.signing.key.alias=$($keystore.keyAlias)",
    "-Pandroid.injected.signing.key.password=$($keystore.keyPassword)"
  )
  Step "Tanda tangan: kunci EAS (credentials.json)"
} else {
  Write-Host "== PERINGATAN: credentials.json tidak ada, APK ditandatangani kunci DEBUG ==" -ForegroundColor Yellow
  Write-Host "   APK ini tidak bisa menimpa aplikasi yang sudah terpasang, dan login Google gagal." -ForegroundColor Yellow
}

# Ninja bawaan Android SDK (1.10) tidak mendukung path lebih dari 260 karakter, sedangkan
# build native React Native membuat path sepanjang itu. Ninja 1.12+ mendukungnya.
# Pasang sekali:  winget install Ninja-build.Ninja
# Skrip lalu menaruhnya di folder cmake Android SDK (yang lama disimpan sebagai ninja-asli.exe).
function NinjaVersion($exe) {
  try { [version](((& $exe --version) | Select-Object -First 1) -replace '[^0-9.].*$', '') } catch { [version]"0.0" }
}
foreach ($sdkNinja in Get-ChildItem "$env:ANDROID_HOME\cmake\*\bin\ninja.exe" -ErrorAction SilentlyContinue) {
  if ((NinjaVersion $sdkNinja.FullName) -ge [version]"1.12") { continue }
  $candidates = @()
  $candidates += Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ninja-build.Ninja*\ninja.exe" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
  $candidates += "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ninja.exe"
  $candidates += Get-Command ninja -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source }
  $newer = $candidates | Where-Object { $_ -and (Test-Path $_) -and ((NinjaVersion $_) -ge [version]"1.12") } | Select-Object -First 1
  if (-not $newer) {
    Set-Location $project
    throw "Butuh Ninja 1.12 atau lebih baru. Jalankan:  winget install Ninja-build.Ninja  lalu buka terminal baru dan ulangi skrip ini."
  }
  $backup = Join-Path $sdkNinja.DirectoryName "ninja-asli.exe"
  if (-not (Test-Path $backup)) { Copy-Item $sdkNinja.FullName $backup }
  Copy-Item $newer $sdkNinja.FullName -Force
  Step "Ninja Android SDK diperbarui ke $(NinjaVersion $sdkNinja.FullName) (dari $newer)"
}

# 5. Rakit
Set-Location "$build\android"
Step "Merakit APK (gradlew assembleRelease)"
& .\gradlew.bat @gradleArgs
if ($LASTEXITCODE -ne 0) { Set-Location $project; throw "Build gagal (lihat pesan di atas)" }

$apk = "$build\android\app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $apk)) { Set-Location $project; throw "APK tidak ditemukan di $apk" }
New-Item -ItemType Directory -Force "$project\dist" | Out-Null
Copy-Item $apk "$project\dist\AirSense.apk" -Force
Set-Location $project
Write-Host ""
Write-Host "SELESAI: $project\dist\AirSense.apk" -ForegroundColor Green
