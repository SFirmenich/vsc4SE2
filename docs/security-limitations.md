# Seguridad, privacidad y limitaciones

Esta extensión genera evidencia local de trabajo; no constituye un sistema inviolable ni una solución forense.

- El estudiante controla su equipo, los archivos, Git, el reloj y la instalación de VS Code.
- La cadena hash permite detectar alteraciones accidentales o ediciones que rompan el encadenamiento, pero un usuario con control local puede regenerarla.
- Los heartbeats ayudan a observar huecos, no demuestran por qué VS Code estuvo cerrado o la extensión inactiva.
- La firma opcional del paquete se conserva, pero el MVP no valida `manifest.sig`.
- No se registra contenido completo de archivos.
- Se excluyen `node_modules`, `.git`, `dist`, `out` y los `events.jsonl` de las contribuciones.
- Las URLs descargadas deben ser de confianza. El extractor rechaza rutas ZIP que escapen de la carpeta temporal.
- La exportación puede incluir `.git` y el historial local completo.
- La protección de `AGENTS.md` funciona mientras la extensión está activa. Un usuario con control local puede desactivar la extensión o modificar archivos fuera de ese periodo.
- La extensión no puede leer chats privados de ChatGPT, Claude o Copilot. El registro `agent-interactions.jsonl` depende de que el agente cumpla las instrucciones incluidas en `AGENTS.md`.
- La vinculación de un workspace a un estudiante evita que la extensión escriba como otro compañero, pero no crea permisos inviolables del sistema de archivos. Un usuario con acceso local directo todavía puede editar archivos ajenos; la extensión registra estas modificaciones cuando puede observarlas.

Para escenarios de evaluación de alto riesgo se necesita verificación externa, políticas institucionales y almacenamiento remoto controlado.
