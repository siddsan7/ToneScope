param([Parameter(Mandatory)][int]$ProcessId,[Parameter(Mandatory)][string]$Title,[Parameter(Mandatory)][string]$Path,[int]$TimeoutSeconds=20)
# Test-only helper: completes one native Open/Save common dialog owned by an explicit
# ToneScope test process. UI Automation locates the dialog by process and title; the
# file-name edit (id 1001 save / 1148 open) receives typed WM_CHAR input, which is
# read back before the dialog's own confirm button is clicked. Other processes are untouched.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -Namespace E2E -Name Win32 -MemberDefinition @'
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, System.Text.StringBuilder lParam);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
'@
$A=[Windows.Automation.AutomationElement];$T=[Windows.Automation.TreeScope]
function Find-Id($root,[string]$id,[string]$class){
  $c=New-Object Windows.Automation.AndCondition((New-Object Windows.Automation.PropertyCondition($A::AutomationIdProperty,$id)),(New-Object Windows.Automation.PropertyCondition($A::ClassNameProperty,$class)))
  $root.FindFirst($T::Descendants,$c)
}
function Get-Text([IntPtr]$handle){
  $length=[int][E2E.Win32]::SendMessage($handle,0x000E,[IntPtr]::Zero,[IntPtr]::Zero)   # WM_GETTEXTLENGTH
  $buffer=New-Object System.Text.StringBuilder ($length+1)
  $null=[E2E.Win32]::SendMessage($handle,0x000D,[IntPtr]($length+1),$buffer)            # WM_GETTEXT
  $buffer.ToString()
}
$deadline=(Get-Date).AddSeconds($TimeoutSeconds);$dialog=$null
while(-not $dialog -and (Get-Date) -lt $deadline){
  $condition=New-Object Windows.Automation.AndCondition((New-Object Windows.Automation.PropertyCondition($A::ProcessIdProperty,$ProcessId)),(New-Object Windows.Automation.PropertyCondition($A::NameProperty,$Title)))
  $dialog=$A::RootElement.FindFirst($T::Descendants,$condition)
  if(-not $dialog){Start-Sleep -Milliseconds 200}
}
if(-not $dialog){throw "No '$Title' dialog owned by process $ProcessId"}
$edit=$null
foreach($id in '1001','1148'){ $edit=Find-Id $dialog $id 'Edit'; if($edit){break} }
if(-not $edit){
  $all=$dialog.FindAll($T::Descendants,[Windows.Automation.Condition]::TrueCondition)
  $tree=@($all | Select-Object -First 80 | ForEach-Object { "$($_.Current.ControlType.ProgrammaticName)|$($_.Current.AutomationId)|$($_.Current.ClassName)|$($_.Current.Name)" }) -join "`n"
  throw "File name field not found. Dialog class=$($dialog.Current.ClassName). Tree:`n$tree"
}
$handle=[IntPtr]$edit.Current.NativeWindowHandle
if($handle -eq [IntPtr]::Zero){throw 'File name field has no window handle'}
$null=[E2E.Win32]::SendMessage($handle,0x00B1,[IntPtr]::Zero,[IntPtr](-1))   # EM_SETSEL all
$null=[E2E.Win32]::SendMessage($handle,0x0102,[IntPtr]8,[IntPtr]::Zero)      # WM_CHAR backspace
foreach($ch in $Path.ToCharArray()){$null=[E2E.Win32]::SendMessage($handle,0x0102,[IntPtr][int]$ch,[IntPtr]::Zero)}  # WM_CHAR
$typed=Get-Text $handle
if($typed -ne $Path){throw "File name field holds '$typed' instead of the requested path"}
$button=Find-Id $dialog '1' 'Button'
if(-not $button){throw 'Dialog confirm button not found'}
$null=[E2E.Win32]::SendMessage([IntPtr]$button.Current.NativeWindowHandle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)   # BM_CLICK
'dialog-completed:'+$edit.Current.AutomationId
