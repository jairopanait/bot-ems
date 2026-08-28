# BOT EMS

Un único bot de Discord que reúne los tres proyectos originales:

- Cumpleaños: registro por mensaje y `/cumple`, consulta, borrado y felicitación automática.
- Postulaciones EMS: aprobación/rechazo escrito y oral, anuncios, roles e intentos.
- Salidas de facción: procesa usuarios mencionados, ajusta roles/apodo y publica la plantilla.
- Inactividades: panel interactivo, roles automáticos, vencimientos y consulta de solicitudes vigentes.

## Puesta en marcha

Requiere Node.js 20 o superior.

1. Copia `.env.example` como `.env` y completa `DISCORD_TOKEN` y `DISCORD_CLIENT_ID`.
2. Activa **Server Members Intent** y **Message Content Intent** en Discord Developer Portal.
3. Instala dependencias con `npm install`.
4. Registra todos los comandos una vez con `npm run deploy`.
5. Inicia BOT EMS con `npm start`.

Solo se utiliza una aplicación y un token de Discord. Al desplegar este proyecto, detén los tres bots antiguos para evitar respuestas duplicadas.

## Datos existentes

Los archivos persistentes mantienen los nombres originales:

- `data/birthdays.json`
- `data/postulations.json`

Si quieres conservar los datos anteriores, copia esos archivos dentro del directorio indicado por `DATA_DIR`. En Railway, monta un volumen y configura `DATA_DIR=/data` o deja que Railway aporte `RAILWAY_VOLUME_MOUNT_PATH`.

## Añadir funciones

Cada función vive en `src/features/<nombre>/index.js` y exporta:

```js
module.exports = {
  name: "mi función",
  commands: [],
  register(client, config) {
    // Registra aquí eventos, tareas programadas y comandos.
  }
};
```

Después importa el módulo en `src/index.js`. Si incluye comandos, añádelo también en `src/commands.js` y ejecuta de nuevo `npm run deploy`.

## Permisos necesarios

BOT EMS necesita ver canales, enviar mensajes, añadir reacciones, leer historial, gestionar roles y gestionar apodos. El rol del bot debe estar por encima de todos los roles que deba añadir o retirar.

## Inactividades

Al arrancar, el bot publica una sola vez el panel **SOLICITAR INACTIVIDAD** en el canal configurado. El campo `Tiempo` acepta un intervalo con el formato `dd/mm/aaaa - dd/mm/aaaa`. La fecha inicial puede ser futura; el rol se añade al llegar ese día y se retira a las 10:00 (hora de Madrid) del día posterior a la fecha final.

- `Total`: duración máxima de un mes natural.
- `Parcial`: aplica el rol parcial durante todo el intervalo.
- `/inactividades`: lista privada para miembros con el rol de consulta configurado.

Los registros se guardan en `data/inactivities.json` o en el volumen persistente indicado por `DATA_DIR`.

## Comprobaciones

```bash
npm run check
```

Nunca subas `.env` ni el token a GitHub.
