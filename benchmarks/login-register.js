const autocannon = require('autocannon')
require('dotenv').config()
const usersData = require('./usersData.json')

function startBench() {
    const url = `http://localhost:${process.env.PORT}`

    let requestNumberIndex = 0
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
                method: "POST",
                path: "/api/auth/new",
                // setupRequest: function (request) {
                //     request.body = JSON.stringify(usersData[requestNumberIndex])
                //     requestNumberIndex++
                //     return request
                // }
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