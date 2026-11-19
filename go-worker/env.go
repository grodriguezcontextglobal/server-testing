package main

import (
	"bytes"
	"fmt"
	"os"
	"sort"

	"github.com/joho/godotenv"
)

/*
Carga del .env — por que esto es un fichero y no dos llamadas a godotenv.Load.

EL DIA QUE ESTO SE ESCRIBIO (2026-11-19) el worker llevaba un rato contestando
`Database connection failed: dial tcp :3306: ... actively refused it` a
peticiones de produccion. No era la red, ni el firewall, ni PlanetScale: el
`.env` habia sido reescrito con `>` o `Out-File` de PowerShell, que en Windows
dejan un BOM de UTF-8 al principio del fichero.

godotenv v1.5.1 no quita ese BOM. Los tres bytes quedan pegados al nombre de la
PRIMERA variable, el parser los rechaza como caracteres no validos en un nombre
y ABANDONA EL FICHERO ENTERO. No es que se perdiera una clave: no se leyo
ninguna.

Y el worker arranco igual, porque las dos llamadas que habia aqui tiraban los
dos errores a la basura:

	if err := godotenv.Load("../.env"); err != nil {
		_ = godotenv.Load(".env")
	}

Con el host vacio, el DSN queda `tcp(:3306)`, que Go resuelve a localhost. De
ahi que el mensaje acusara a la red de un problema de configuracion, y que el
primer sintoma fuera un 500 en el navegador de un usuario en vez de una linea
de log al arrancar.

QUE HACE ESTO DISTINTO:

 1. Lee el fichero y QUITA EL BOM antes de parsear, asi que la causa exacta de
    aquel dia no puede repetirse.
 2. Deja en el log de que ruta cargo y cuantas claves leyo. Un arranque sano y
    uno vacio dejan de parecerse.
 3. Comprueba las claves sin las que no puede trabajar y, si falta alguna, NO
    ARRANCA. Un worker sin base de datos no esta degradado: va a contestar
    errores a todo el mundo hasta que alguien lo note, y lo notara un usuario.

NUNCA SE REGISTRA UN VALOR. Solo el nombre de la clave y si esta o no: este log
lo lee cualquiera que mire logs/go-worker.log.
*/

// Las dos rutas, en orden. `../.env` es la de produccion —el servicio corre con
// AppDirectory en go-worker\— y `.env` la de quien lo ejecuta a mano desde la
// raiz del repo.
var envPaths = []string{"../.env", ".env"}

// Las claves sin las cuales el worker no puede hacer NADA de lo que se le pide.
// Deliberadamente no incluye STRIPE_SECRET_KEY: sin ella fallan los comandos de
// Stripe y solo esos, asi que InitStripe la comprueba por su cuenta y el resto
// del worker sigue sirviendo. Esta lista es "no puede trabajar", no "falta algo".
var requiredEnv = []string{
	"DB_CNN",
	"PLANETSCALE_DATABASE_HOST",
	"PLANETSCALE_DATABASE_NAME",
	"PLANETSCALE_DATABASE_PASSWORD",
	"PLANETSCALE_DATABASE_USERNAME",
}

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// loadEnvFile parsea un .env y devuelve cuantas claves puso en el entorno.
//
// Respeta la regla de godotenv.Load: lo que YA viene en el entorno manda sobre
// el fichero, para que nssm pueda sobreescribir una clave sin editar el .env.
func loadEnvFile(path string) (int, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}

	parsed, err := godotenv.Unmarshal(string(bytes.TrimPrefix(raw, utf8BOM)))
	if err != nil {
		return 0, fmt.Errorf("%s: %w", path, err)
	}

	loaded := 0
	for key, value := range parsed {
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return loaded, fmt.Errorf("%s: %s: %w", path, key, err)
		}
		loaded++
	}
	return loaded, nil
}

// LoadEnv carga el entorno y se niega a seguir si falta algo imprescindible.
//
// Necesita el logger ya inicializado: en main() va DESPUES de InitLogger(), que
// no depende de ninguna variable de entorno.
func LoadEnv() {
	var failures []string

	for _, path := range envPaths {
		keys, err := loadEnvFile(path)
		if err != nil {
			// Que el segundo no exista es lo normal en produccion, no un
			// problema. Que exista y no parsee si lo es, y por eso se guarda
			// el error: es la pista que falto el 2026-11-19.
			if !os.IsNotExist(err) {
				failures = append(failures, err.Error())
			}
			continue
		}
		LogInfo("env file loaded", map[string]any{"path": path, "keys": keys})
		break
	}

	for _, problem := range failures {
		LogError("env file could not be parsed", fmt.Errorf("%s", problem), nil)
	}

	var missing []string
	for _, key := range requiredEnv {
		if os.Getenv(key) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) == 0 {
		return
	}
	sort.Strings(missing)

	detail := map[string]any{
		"missing": missing,
		"tried":   envPaths,
		"cwd":     workingDir(),
	}
	if len(failures) > 0 {
		detail["parseErrors"] = failures
	}
	LogError("refusing to start: required environment variables are missing", nil, detail)

	// Tambien a stderr: si el log no se puede abrir, o si quien mira es nssm y
	// no el fichero, este es el unico sitio donde el motivo aparece.
	fmt.Fprintf(os.Stderr,
		"go-worker: refusing to start. Missing %v. Tried %v from %s.\n"+
			"A .env written by PowerShell `>` or Out-File carries a UTF-8 BOM; "+
			"strip the first three bytes (239 187 191) and restart.\n",
		missing, envPaths, workingDir())
	os.Exit(1)
}

func workingDir() string {
	dir, err := os.Getwd()
	if err != nil {
		return "unknown"
	}
	return dir
}
