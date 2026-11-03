# Agenda o Diário X no Windows: a IA do config.json monta a edição todo dia às 09:00
# e também quando o PC liga (se ainda não houver edição do dia).
# Rode uma vez (botão direito > Executar com PowerShell). Para remover:
#   Unregister-ScheduledTask -TaskName "Diario X - edicao" -Confirm:$false
$proj = $PSScriptRoot
$node = (Get-Command node).Source
$acaoDiaria = New-ScheduledTaskAction -Execute $node -Argument "`"$proj\rodar-edicao.mjs`"" -WorkingDirectory $proj
$gatilhoDiario = New-ScheduledTaskTrigger -Daily -At 09:00
$gatilhoLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$gatilhoLogon.Delay = 'PT2M'   # dá 2 min para a rede subir
# StartWhenAvailable: se o PC estava desligado às 09:00, roda assim que ligar
$opcoes = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
# a mesma ação serve aos dois gatilhos: o script ignora se a edição do dia já existe
$tarefa = New-ScheduledTask -Action $acaoDiaria -Trigger @($gatilhoDiario, $gatilhoLogon) -Settings $opcoes -Description "Monta a edição do Diário X com a IA do config.json (09:00 ou ao ligar o PC)"
Register-ScheduledTask -TaskName "Diario X - edicao" -InputObject $tarefa -Force | Out-Null
Write-Host "Pronto: 'Diario X - edicao' roda às 09:00 e ao ligar o PC. Log em $proj\logs\"
