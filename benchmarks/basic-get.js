const autocannon = require('autocannon')
require('dotenv').config()

function startBench() {
    const url = `http://localhost:${process.env.PORT}`
    const args = process.argv.slice(2)
    const numConnections = args[0] || 1000;
    const maxConnectionRequests = args[1] || 1000
    const instance = autocannon({
        url,
        connections: numConnections,
        workers: 4,
        duration: 10,
        maxConnectionRequests,
        headers: {
            'content-type': 'application/json'
        },
        requests: [
            {
                method: "GET",
                path: "/"
            }
        ]
    },

        finishedBench
    )


    autocannon.track(instance)
    function finishedBench(err, res) {
        console.log("Finished Bench", err, res)
    }
}

startBench()