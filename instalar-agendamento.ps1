# Agenda o Diário X no Windows: todo dia às 07:00 o Antigravity monta a edição.
# Rode uma vez (botão direito > Executar com PowerShell). Para remover:
#   Unregister-ScheduledTask -TaskName "Diario X - edicao" -Confirm:$false
$proj = $PSScriptRoot
$node = (Get-Command node).Source
$acao = New-ScheduledTaskAction -Execute $node -Argument "`"$proj\rodar-edicao.mjs`"" -WorkingDirectory $proj
$quando = New-ScheduledTaskTrigger -Daily -At 07:00
# StartWhenAvailable: se o PC estava desligado às 07:00, roda assim que ligar
$opcoes = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "Diario X - edicao" -Action $acao -Trigger $quando -Settings $opcoes -Description "Monta a edição do Diário X com o Antigravity" -Force | Out-Null
Write-Host "Pronto: 'Diario X - edicao' agendada para 07:00. Log em $proj\logs\"
