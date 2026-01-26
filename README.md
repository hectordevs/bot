# Qwen3-0.6B Local Interface

Este proyecto proporciona una interfaz web simple (`index.html`) para ejecutar el modelo de lenguaje **Qwen3-0.6B** localmente en tu navegador utilizando [Transformers.js](https://huggingface.co/docs/transformers.js).

## Requisitos

- Un navegador moderno (Chrome, Edge, Firefox) con soporte para WebGPU o WebAssembly.
- Python 3 instalado (para ejecutar un servidor local simple).

## Instrucciones de Uso

1.  **Iniciar el Servidor Local**
    Para evitar problemas de seguridad del navegador (CORS) al cargar módulos, debes servir el archivo `index.html` a través de HTTP en lugar de abrirlo directamente.

    Abre una terminal en esta carpeta y ejecuta:
    ```bash
    python3 -m http.server 8000
    ```
    (O usa cualquier otro servidor estático como `http-server` de Node.js).

2.  **Abrir la Aplicación**
    Abre tu navegador y ve a: [http://localhost:8000](http://localhost:8000)

3.  **Primer Uso (Con Internet)**
    -   Al cargar la página por primera vez, el modelo (`onnx-community/Qwen3-0.6B-ONNX`) se descargará automáticamente desde Hugging Face.
    -   Esto puede tardar unos minutos dependiendo de tu conexión (aprox. 300-600 MB).
    -   Verás el estado en la página indicando "Cargando modelo...".

4.  **Uso Offline**
    -   Una vez que el modelo se haya cargado exitosamente la primera vez, se almacenará en la caché del navegador.
    -   Para las siguientes ejecuciones, puedes desconectar Internet y seguir usando la aplicación localmente (siempre que el servidor local siga corriendo).

5.  **Ejecutar Consultas**
    La interacción se realiza a través de la consola del desarrollador del navegador.
    -   Presiona `F12` o `Ctrl+Shift+I` para abrir la consola.
    -   Escribe el comando `ask()` con tu pregunta y un callback para recibir la respuesta.

    **Ejemplo:**
    ```javascript
    ask("Hola, ¿cómo estás?", (respuesta) => {
        console.log("Respuesta del modelo:", respuesta);
    });
    ```

    El modelo generará texto y ejecutará tu función callback con el resultado.
