'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { beneath } = require('./cloud-files.cjs');
const execute = promisify(execFile);

// Only Cloud Files metadata and provider pin requests: no payload reads, file
// deletion, shell-interpolated paths or recursive folder operations.
const script = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class StudioCloudCache {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateFileW(string p,uint a,uint s,IntPtr x,uint c,uint f,IntPtr t);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern uint GetCompressedFileSizeW(string p,out uint high);
 [DllImport("cldapi.dll")] public static extern int CfGetPlaceholderInfo(IntPtr h,int c,IntPtr b,uint n,out uint used);
 [DllImport("cldapi.dll")] public static extern int CfSetPinState(IntPtr h,int p,uint f,IntPtr o);
 public static long Allocated(string p) { uint high; uint low=GetCompressedFileSizeW(p,out high); if(low==UInt32.MaxValue) throw new Exception("Cache allocation unavailable"); return ((long)high<<32)|low; }
 public static string Release(string p) {
  IntPtr h=CreateFileW(p,0x80,7,IntPtr.Zero,3,0x2200000,IntPtr.Zero);
  if(h==new IntPtr(-1)) throw new Exception("Cloud metadata unavailable");
  IntPtr b=Marshal.AllocHGlobal(65536);
  try { uint used;
   if(CfGetPlaceholderInfo(h,0,b,65536,out used)!=0 || Marshal.ReadInt32(b,4)!=1) throw new Exception("iCloud has not confirmed this copy yet");
   if(Marshal.ReadInt32(b,0)==1) return "kept_downloaded";
   if(Allocated(p)==0) return "cloud_only";
   CloseHandle(h); h=CreateFileW(p,0x81,7,IntPtr.Zero,3,0x2200000,IntPtr.Zero);
   if(h==new IntPtr(-1)) throw new Exception("Cloud cache handle unavailable");
   if(CfSetPinState(h,0,0,IntPtr.Zero)!=0 || CfSetPinState(h,2,0,IntPtr.Zero)!=0) throw new Exception("iCloud did not accept Free up space");
   return "requested";
  } finally { Marshal.FreeHGlobal(b); CloseHandle(h); }
 }
}
'@
$ErrorActionPreference = 'Stop'
$target = $env:MABEL_STUDIO_CLOUD_TARGET
if ((Get-Item -LiteralPath $target).Length -ne [long]$env:MABEL_STUDIO_CLOUD_BYTES) { throw 'Cloud file size changed' }
$result = [StudioCloudCache]::Release($target)
$deadline = (Get-Date).AddSeconds(90)
if ($result -eq 'requested') {
 while ([StudioCloudCache]::Allocated($target) -gt 0) {
  if ((Get-Date) -gt $deadline) { throw 'Waiting for iCloud to free the local cache. Retry later.' }
  Start-Sleep -Milliseconds 500
 }
 $result = 'cloud_only'
}
@{ status=$result; allocated=[StudioCloudCache]::Allocated($target) } | ConvertTo-Json -Compress
`;

async function freeCloudCache(file, bytes, signal, run = execute) {
  const before = fs.statSync(file);
  if (!before.isFile() || before.size !== bytes) throw new Error('The iCloud copy changed before space release.');
  let stdout;
  try { ({ stdout } = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 110000, maxBuffer: 32768, signal,
    env: { ...process.env, MABEL_STUDIO_CLOUD_TARGET: file, MABEL_STUDIO_CLOUD_BYTES: String(bytes) },
  })); } catch { throw new Error('iCloud has not released its local cache yet. The cloud copy and working files are safe; retry to finish freeing space.'); }
  const result = JSON.parse(stdout.trim()), after = fs.statSync(file);
  if (after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('The iCloud file changed during space release.');
  if (!['cloud_only', 'kept_downloaded'].includes(result.status)) throw new Error('iCloud has not finished releasing local space.');
  return result;
}
async function releaseCloudCaches(remote, local, store, portal, signal, release = freeCloudCache) {
  if (!remote.destination.temporaryWork || local.cloudCacheReleased) return;
  const root = path.join(store.state.settings.iCloudRoot || path.join(process.env.USERPROFILE, 'iCloudDrive'), 'Media');
  const copies = new Map(Object.values(local.savedCloudCopies || {}).map(copy => [copy.id || copy.path, copy]));
  const released = [];
  for (const receipt of copies.values()) {
    if (!receipt.confirmed || !receipt.id || !receipt.bytes) throw new Error('The retained cloud copy needs confirmation before freeing space.');
    const item = await portal.api('/api/studio/cloud/item?id=' + encodeURIComponent(receipt.id), { signal });
    if (item.bytes !== receipt.bytes || item.remoteId !== receipt.remoteId || item.modified !== receipt.modified) throw new Error('The retained iCloud copy changed. Local files were kept.');
    const file = beneath(root, item.path);
    if (!fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep)) throw new Error('The cache file is outside the iCloud media folder.');
    released.push({ id: receipt.id, path: item.path, ...await release(file, receipt.bytes, signal) });
  }
  if (copies.size) store.update(local.id, { cloudCacheReleased: true, cloudCacheReceipts: released });
}
module.exports = { freeCloudCache, releaseCloudCaches };
