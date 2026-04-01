function Show-Menu {
    Clear-Host
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "    Xadrez Giacomel - Gestão do Sistema" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "1. Iniciar o Sistema (npm start)"
    Write-Host "2. Parar o Sistema"
    Write-Host "3. Reiniciar o Sistema"
    Write-Host "4. Sair"
    Write-Host "========================================" -ForegroundColor Green
}

function Get-ServerProcess {
    # Procura processo escutando na porta 3000
    $connection = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
    if ($connection) {
        return Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
    }
    return $null
}

function Start-System {
    $proc = Get-ServerProcess
    if ($proc) {
        Write-Host "O sistema já está em execução (PID: $($proc.Id))" -ForegroundColor Yellow
    } else {
        Write-Host "Iniciando o servidor..." -ForegroundColor Green
        Start-Process "cmd.exe" -ArgumentList "/c npm start" -NoNewWindow
        Start-Sleep -Seconds 3
        
        $newProc = Get-ServerProcess
        if ($newProc) {
            Write-Host "Servidor iniciado com sucesso na porta 3000!" -ForegroundColor Green
        } else {
            Write-Host "Falha ao iniciar o servidor. Verifique o console." -ForegroundColor Red
        }
    }
}

function Stop-System {
    $proc = Get-ServerProcess
    if ($proc) {
        Write-Host "Parando o sistema (PID: $($proc.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $proc.Id -Force
        Write-Host "Sistema parado com sucesso." -ForegroundColor Green
    } else {
        Write-Host "O sistema não está em execução." -ForegroundColor Red
    }
}

function Restart-System {
    Stop-System
    Start-Sleep -Seconds 1
    Start-System
}

do {
    Show-Menu
    $choice = Read-Host "Escolha uma opção (1-4)"
    
    switch ($choice) {
        "1" { Start-System }
        "2" { Stop-System }
        "3" { Restart-System }
        "4" { Write-Host "Saindo..."; break }
        default { Write-Host "Opção inválida!" -ForegroundColor Red }
    }
    
    if ($choice -ne "4") {
        Read-Host "`nPressione Enter para continuar..."
    }
} while ($choice -ne "4")
