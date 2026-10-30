!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Nimbo"
    Delete "$APPDATA\${BUNDLEID}\startup-initialized"
  ${EndIf}
!macroend
