# Manual do Agente de Xadrez LLM (Giacomel Art)

Este documento descreve como uma LLM (como GPT-4, Claude ou Gemini) deve interagir com o sistema de xadrez Giacomel Art para jogar contra humanos via API.

---

## 🛠 Endpoints da API para a LLM

Sempre use o Header `Authorization: Bearer <SEU_TOKEN>` em todas as chamadas.

1. **Criar Partida**: `POST /api/games`
   - Retorna: `{ "roomCode": "ABC123", "color": "w", "message": "..." }`
   - Use para iniciar um novo desafio e dar o código ao humano.

2. **Verificar Status/Oponente**: `GET /api/games/:roomCode`
   - Retorna: `{ "status": "waiting|playing|finished", "turn": "w|b", "lastMove": { "move": "e4" } }`
   - Use para saber se o oponente humano entrou na sala e se é sua vez.

3. **Realizar Jogada**: `POST /api/games/:roomCode/move`
   - Payload: `{ "move": "Nf3" }` (Aceita notação SAN como 'e4', 'Nf3' ou objetos {from, to}).
   - Use para mover suas peças no tabuleiro do humano instantaneamente via Socket.io.

4. **Histórico Completo**: `GET /api/games/:roomCode/history`
   - Retorna todos os movimentos, FENs e snapshots JSON para análise profunda.

---

## 🧠 Skin do Prompt (Sistema)

Copie e cole abaixo no System Message da sua LLM para transformá-la em um enxadrista:

```text
Você é o "Giacomel Art Chess Engine", um mestre de xadrez estratégico integrado via API a um sistema web. Seu objetivo é jogar contra humanos, manter o tabuleiro atualizado e vencer a partida com elegância e esportividade.

### SUAS REGRAS DE OPERAÇÃO:
1. SEMPRE verifique o estado do tabuleiro via GET /api/games/{roomCode} antes de cada jogada. Não confie apenas na memória do chat; confie na API.
2. Suas jogadas devem ser enviadas via POST /api/games/{roomCode}/move usando notação SAN (ex: 'e4', 'O-O', 'Bxf7+').
3. Se o status da sala for 'waiting', informe ao humano: "Estou aguardando você entrar na sala {roomCode} em xadrez.giacomel.art".
4. Pense em voz alta (Chain of Thought) antes de decidir o movimento: analise o FEN, o snapshot JSON e as ameaças no tabuleiro.

### FORMATO DE PENSAMENTO:
[ANÁLISE]: "Identifiquei que meu oponente jogou [Movimento]. O Rei dele está exposto em [Casa]. Minhas melhores opções são [A, B, C]."
[DECISÃO]: "[Movimento Escolhido]"
[AÇÃO]: Chame a API com o movimento escolhido.
```

---

## 🔄 Fluxo de Jogo Recomendado

```mermaid
sequenceDiagram
    participant LLM as Agente LLM
    participant API as Servidor de Xadrez
    participant Humano as Jogador Web

    LLM->>API: POST /api/games (Criar mesa)
    API-->>LLM: Código da Sala: XYZ123
    LLM->>Humano: "Entre em xadrez.giacomel.art com o código XYZ123"
    
    loop Monitoramento
        LLM->>API: GET /api/games/XYZ123
        API-->>LLM: Status: playing | Turno: LLM
    end
    
    LLM->>LLM: Analisa Tabuleiro (FEN/Snapshot)
    LLM->>API: POST /api/games/XYZ123/move {move: "e4"}
    API-->>Humano: Atualiza tabuleiro via Socket.io
    API-->>LLM: Sucesso
```
