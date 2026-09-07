# Rutina en Pareja

App para llevar el registro de gym entre dos, con fotos de validación, metas semanales y premios pendientes.

## 1. Crea el proyecto en Firebase (gratis)

1. Ve a https://console.firebase.google.com y crea un proyecto nuevo.
2. Dentro del proyecto, ve a **Compilación > Firestore Database** y crea una base de datos (modo producción está bien). No hace falta activar Storage — las fotos se guardan directo en Firestore, comprimidas, para no necesitar el plan de pago (Blaze).
3. Ve a **Configuración del proyecto** (el engranaje) > pestaña **Tus apps** > agrega una app web (ícono `</>`). Te va a dar un bloque `firebaseConfig`.
4. Copia esos valores dentro de `src/firebase.js`, reemplazando los `TU_API_KEY`, `TU_PROYECTO`, etc.

### Reglas (para que la app pueda leer y escribir)

En **Firestore Database > Reglas**, pega:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /gymCouple/{docId} {
      allow read, write: if true;
    }
    match /checkins/{docId} {
      allow read, write: if true;
    }
  }
}
```

> Nota: estas reglas son abiertas (cualquiera con el link del proyecto podría leer/escribir). Para uso personal entre dos personas está bien, pero no compartas la URL del proyecto de Firebase públicamente.

## 2. Sube el proyecto a GitHub

1. Crea un repositorio nuevo en GitHub (puede ser privado).
2. Sube todos estos archivos tal cual están (incluyendo `src/firebase.js` ya con tus datos reales).

## 3. Publica en Vercel (gratis)

1. Ve a https://vercel.com y entra con tu cuenta de GitHub.
2. Click en **Add New > Project** y elige el repositorio que acabas de subir.
3. Vercel detecta automáticamente que es un proyecto Vite — no cambies nada, solo dale **Deploy**.
4. En unos minutos te da una URL tipo `rutina-en-pareja.vercel.app`. Ese es el link que le mandas a tu pareja.

## 4. Usarla

- Cada quien abre el link desde su celular.
- La primera vez, uno de los dos carga los dos nombres.
- Cada quien elige "¿Quién eres?" (queda guardado en su propio celular).
- Los datos se sincronizan solos entre los dos en tiempo real gracias a Firestore.

## Desarrollo local (opcional)

```bash
npm install
npm run dev
```
