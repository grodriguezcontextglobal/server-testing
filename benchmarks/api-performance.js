const { performance, PerformanceObserver } = require("perf_hooks")

const apiPerformance = async () => {
    const perfObserver = new PerformanceObserver((items) => {
        items.getEntries().forEach((entry) => {
            console.log("🚀 ~ items.getEntries ~ entry:", entry)
        })
    })

    perfObserver.observe({ entryTypes: ["measure"], buffer: true })

    try {
        performance.mark('swapi-start')
        await fetch('https://serv-testing-0af3adceaca2.herokuapp.com/api/admin/login', {
            method: "POST",
            body: {
                email: "grodriguez@contextglobal.com",
                password: "147258"
            },
            headers: {
                "Content-Type": "application/json",
            },
        })
    } catch (err) {
        console.error(err)
    } finally {
        performance.mark('swapi-end')
        performance.measure('https://serv-testing-0af3adceaca2.herokuapp.com/api/admin/login', 'swapi-start', 'swapi-end')
    }
}

apiPerformance()