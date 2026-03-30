const express = require('express');
const router = express.Router();
const os = require('os');
const process = require('process');

// Get server status information
router.get('/status', async (req, res) => {
    try {
        const status = {
            status: 'operational',
            version: process.env.npm_package_version || '1.0.0',
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            system: {
                platform: process.platform,
                memory: {
                    total: os.totalmem(),
                    free: os.freemem(),
                    used: os.totalmem() - os.freemem()
                },
                cpu: {
                    cores: os.cpus().length,
                    load: os.loadavg()
                }
            }
        };

        res.json(status);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch server status'
        });
    }
});

router.get('/health', (req, res) => {
    res.status(200).json({
        ok: true,
        message: 'Server is healthy',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;