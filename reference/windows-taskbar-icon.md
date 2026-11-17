# 修改 Windows 任务栏图标（合并任务栏按钮时）

> 适用：Windows 10 / 11。改的是「任务栏按钮上显示的图标」，不是标题栏图标、也不是桌面快捷方式的外观。
> 结论对任何程序成立：**任务栏图标不看窗口图标，也不看你改的快捷方式图标本身**，它看的是「进程的 AppUserModelID 所对应的那个快捷方式」。

## TL;DR

| 程序情况 | 可行做法 | 能否不动程序本体 |
| --- | --- | --- |
| 程序自己设置了 AppUserModelID（Electron / 新版套壳应用常见） | 建一个 **同 AUMID** 的快捷方式，图标指向你想要的文件 | 可以 |
| 传统 Win32 程序，没设 AUMID | 只能改 **exe 的图标资源**（rcedit / Resource Hacker） | 不行，要改文件 |
| 有源码 | 启动时叫 `SetCurrentProcessExplicitAppUserModelID` / `app.setAppUserModelId`，再配同 ID 快捷方式 | 最干净 |
| 有调试端口 / 可注入（如 Electron 的 `--inspect`） | 注入后设 AUMID + 写快捷方式 + 窗口 setIcon | 可以 |
| UWP / 商店应用 | 图标来自包清单，改不了（除非重新打包） | 不行 |

---

## 1. 任务栏图标的真实来源

一个运行中的窗口，可能被这三样东西认领：

1. **exe 的图标资源**（PE 里的 icon group）
2. **窗口图标**（`WM_SETICON`，即 `SetIcon` / Electron 的 `win.setIcon`）—— 决定标题栏、Alt+Tab
3. **AppUserModelID（AUMID）→ 同 ID 快捷方式的图标**

任务栏（explorer 的 taskbar）在合并按钮模式下按这个顺序取图标：

```
窗口的 PKEY_AppUserModel_ID（窗口属性）
  ↓ 空
进程级 AUMID（SetCurrentProcessExplicitAppUserModelID）
  ↓ 空 → 退回用 exe 路径当隐式身份
    在开始菜单（Programs 树）与桌面里找 System.AppUserModel.ID == 该 AUMID 的 .lnk
      ↓ 找到 → 用这个 lnk 的图标
      ↓ 没找到 → 用进程 exe 的图标资源
```

这就是为什么：

- 只改桌面快捷方式的「图标」→ **标题栏变了，任务栏没变**（快捷方式不是任务栏取图标的地方）
- 把快捷方式目标改成 `wscript.exe` 之类的中转程序 → 任务栏更不会变（中转程序不是创建窗口的那个进程）
- 换掉 AUMID 之后任务栏图标立刻变了（哪怕 exe 一个字节都没动）

## 2. 先判断程序是哪一类

### 2.1 读某个窗口的 AUMID

窗口属性里可能直接就有（Firefox、Steam 这类会写），也可能为空。Electron 一般写在进程级，窗口里读不到不代表没设。

```powershell
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct PROPERTYKEY { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit)] public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointerValue; }
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
  uint GetCount();
  void GetAt(uint iProp, out PROPERTYKEY pkey);
  void GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
  void SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
  void Commit();
}
public static class WindowAumid {
  [DllImport("shell32.dll", PreserveSig = false)]
  static extern void SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);
  static PROPERTYKEY PKEY = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
  public static string Get(IntPtr hwnd) {
    try {
      IPropertyStore store; var iid = typeof(IPropertyStore).GUID;
      SHGetPropertyStoreForWindow(hwnd, ref iid, out store);
      PROPVARIANT pv; store.GetValue(ref PKEY, out pv);
      try { return (pv.vt == 31 && pv.pointerValue != IntPtr.Zero) ? Marshal.PtrToStringUni(pv.pointerValue) : "(none)"; }
      finally { PropVariantClear(ref pv); Marshal.ReleaseComObject(store); }
    } catch (Exception e) { return "(error: " + e.Message + ")"; }
  }
}
"@

Get-Process | Where-Object { `_.MainWindowHandle -ne 0 } | ForEach-Object {
  Write-Output (`_.ProcessName + '  pid=' + `_.Id + '  aumid=' + [WindowAumid]::Get(`_.MainWindowHandle))
}
```

### 2.2 读某个快捷方式里登记的 AUMID

```powershell
. .\Set-LnkAumid.ps1     # 脚本见第 8 节
[AppUserModel]::Get("C:\Users\me\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\某应用.lnk")
```

### 2.3 判断

- 开始菜单里已有带 AUMID 的 lnk，且那是程序自己注册的 → 走**方法 A**
- lnk 没有 AUMID，程序又是老 Win32 → 大概率走**方法 B**
- Electron / 有 `--inspect` / 你能改它的代码 → 走**方法 C**

## 3. 方法 A：建一个同 AUMID 的快捷方式（不动程序本体）

前提：程序运行时设了自己能识别的 AUMID。若程序根本没设，Windows 用 exe 路径当身份，这时你造不出匹配的快捷方式，只能走方法 B。

步骤：

1. 拿到程序的 AUMID（第 2 节；或看它已有的快捷方式）
2. 在 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\` 下（任意子目录）新建快捷方式，**目标指向真正的 exe**（不是转发脚本）
3. 给它设两样东西：**图标**（WScript.Shell 就能改）和 **`System.AppUserModel.ID`**（要用 IPropertyStore，WScript.Shell 改不了）

注意：

- 快捷方式放在开始菜单或桌面即可被搜索到；文件名随意，关键是 **lnk 内部登记的那个 AppUserModel.ID 属性**
- 图标填 `.ico` 文件路径；填 `.exe` 也行（用该 exe 的第 0 个图标）
- 同 AUMID 的窗口会合并成同一个任务栏按钮：分组统一，但同一程序的多个实例也会并成一个

## 4. 方法 B：改 exe 的图标资源（传统程序）

只对「任务栏回退到 exe 图标」的程序有效。

### rcedit（命令行）

```powershell
# https://github.com/electron/rcedit/releases
.\rcedit-x64.exe "C:\Path\App.exe" --set-icon "C:\Path\my.ico"
```

### Resource Hacker（图形界面）

打开 exe → Icon Group → 替换 → 保存。改前先备份。

代价：

- **数字签名失效**：Authenticode 覆盖文件内容，改资源后签名作废，SmartScreen / 企业策略可能报警
- **程序更新会覆盖**：每次升级都要重做
- **少数程序会自校验**：可能拒绝启动
- 改完要重启资源管理器（见第 6 节）

## 5. 方法 C：让程序自己设（有源码 / 能注入）

### 5.1 原生 Win32

```cpp
// 必须在创建任何窗口之前调用
SetCurrentProcessExplicitAppUserModelID(L"MyCompany.MyApp");
```

再配一个同 ID 的快捷方式（方法 A），任务栏图标就会跟着快捷方式走。`WM_SETICON` 设窗口图标只影响标题栏与 Alt+Tab。

### 5.2 Electron

```js
const { app, shell, BrowserWindow, nativeImage } = require('electron');
app.setAppUserModelId('MyCompany.MyApp');   // 必须在窗口创建前

// 同 AUMID 的开始菜单快捷方式，图标用你自己的
shell.writeShortcutLink(
  path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'MyApp (Custom).lnk'),
  'create',
  {
    target: app.getPath('exe'),
    cwd: path.dirname(app.getPath('exe')),
    icon: 'C:\\icons\\my.ico',
    iconIndex: 0,
    appUserModelId: 'MyCompany.MyApp',
  }
);

// 窗口图标（标题栏 / Alt+Tab）
win.setIcon(nativeImage.createFromPath('C:\\icons\\my.ico'));
```

### 5.3 运行时注入（没有源码）

以 Electron 为例：用 `--inspect=<port>` 启动，连 CDP 在主进程执行上面那段。要点：

- `app.setAppUserModelId` 要在窗口创建前调用才可靠
- 写快捷方式用的是**进程自己的 `APPDATA`**；若启动环境的 `APPDATA` 被重定向（某些隔离/开发环境会这么干），lnk 会落进那个假目录，任务栏不会变
- `win.setIcon` 只改窗口图标（标题栏、Alt+Tab），**不改**任务栏按钮

参考实现：<https://github.com/Luoyur0/dsh-close-dialog> 的 `hook-inject.js`（`applyWindowIcon` + `ensureTaskbarIdentity`）。

## 6. 刷新缓存与验证

改完没反应时：

```powershell
# 刷新图标缓存
ie4uinit.exe -show

# 重启资源管理器（所有窗口保留，屏幕闪一下）
Stop-Process -Name explorer -Force
Start-Process explorer

# 程序若被固定到任务栏：先取消固定，再重新固定
```

验证思路：

- **用分组行为反推 AUMID 是否生效**：把该程序的两个窗口都开出来，看是否合并成一个按钮；合并说明 AUMID 生效了
- 换一个完全不同的图标再重启：任务栏跟着变 → 取的是快捷方式图标；不变 → 程序没用 AUMID，走的是 exe 图标
- 用第 8 节脚本把 lnk 的 AUMID 读回来，确认它等于程序设置的值

## 7. 常见坑

1. **只改了快捷方式外观** —— 任务栏不变是正常的，两回事
2. **快捷方式目标被改成中转程序**（.cmd / wscript.exe / 自写 launcher）—— 任务栏看的是创建窗口的进程，不是中转者
3. **lnk 放错位置** —— 必须在开始菜单 Programs 树或桌面，否则搜不到
4. **只在文件名里写 AUMID** —— 必须写进 lnk 的 `System.AppUserModel.ID` 属性
5. **AUMID 设得太晚** —— 窗口创建后再设，任务栏按钮可能还挂在旧身份上，需重启进程
6. **环境的 `APPDATA` 被重定向** —— lnk 写进了假目录
7. **改了 exe 导致签名失效** —— 某些环境会拦；更新后要重做
8. **任务栏缓存** —— 偶发不刷新，重启 explorer
9. **通知（toast）也依赖 AUMID** —— 换 AUMID 后系统通知的归属跟着变；程序若用 AUMID 做通知分类，要么沿用原值，要么保证新 ID 也有对应快捷方式

## 8. 附：给快捷方式设置 / 读取 AUMID 的脚本

存成 `Set-LnkAumid.ps1`，用点号引入：

```powershell
. .\Set-LnkAumid.ps1
[AppUserModel]::Set('C:\path\to\app.lnk', 'MyCompany.MyApp')
[AppUserModel]::Get('C:\path\to\app.lnk')
```

```powershell
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct PROPERTYKEY { public Guid fmtid; public int pid; }

[StructLayout(LayoutKind.Explicit)]
public struct PROPVARIANT {
  [FieldOffset(0)] public ushort vt;
  [FieldOffset(8)] public IntPtr pointerValue;
}

[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
  uint GetCount();
  void GetAt(uint iProp, out PROPERTYKEY pkey);
  void GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
  void SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
  void Commit();
}

public static class AppUserModel {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHGetPropertyStoreFromParsingName(string path, IntPtr pbc, uint flags, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

  [DllImport("ole32.dll")]
  static extern int PropVariantClear(ref PROPVARIANT pv);

  // PKEY_AppUserModel_ID = {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, 5
  static PROPERTYKEY PKEY_AUMID = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };

  public static void Set(string path, string aumid) {
    IPropertyStore store;
    var iid = typeof(IPropertyStore).GUID;
    SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2 /* GPS_READWRITE */, ref iid, out store);
    var pv = new PROPVARIANT { vt = 31 /* VT_LPWSTR */ };
    pv.pointerValue = Marshal.StringToCoTaskMemUni(aumid);
    try {
      store.SetValue(ref PKEY_AUMID, ref pv);
      store.Commit();
    } finally {
      Marshal.FreeCoTaskMem(pv.pointerValue);
      Marshal.ReleaseComObject(store);
    }
  }

  public static string Get(string path) {
    IPropertyStore store;
    var iid = typeof(IPropertyStore).GUID;
    SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 0, ref iid, out store);
    PROPVARIANT pv;
    store.GetValue(ref PKEY_AUMID, out pv);
    try {
      if (pv.vt == 31 && pv.pointerValue != IntPtr.Zero) return Marshal.PtrToStringUni(pv.pointerValue);
      return null;
    } finally {
      PropVariantClear(ref pv);
      Marshal.ReleaseComObject(store);
    }
  }
}
"@
```

图标仍用 WScript.Shell 单独改（两件事分开做）：

```powershell
`shell = New-Object -ComObject WScript.Shell
`lnk = `shell.CreateShortcut('C:\Path\App.lnk')
`lnk.TargetPath = 'C:\Path\App.exe'
`lnk.IconLocation = 'C:\Path\my.ico,0'
`lnk.Save()
```

改完用 `[AppUserModel]::Get(...)` 读回来确认再依赖它。
