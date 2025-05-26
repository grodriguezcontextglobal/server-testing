const cloudinary = require('cloudinary').v2;
const Document = require('../models/Document');
const fs = require('fs');
const util = require('util');
const unlinkFile = util.promisify(fs.unlink);

// Configure cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadDocument = async (req, res) => {
    try {
        const {
            document_type,
            trigger_action,
            at_,
            title,
            description,
            language,
            requires_signature,
            expiration_date,
            applicable_locations,
            applicable_items,
            applicable_events,
            tags,
            metadata,
            document_config
        } = req.body;

        const { company_id, uid: created_by } = req.user;

        if (!req.file) {
            return res.status(400).json({
                ok: false,
                msg: 'No document file uploaded'
            });
        }

        // Upload to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
            resource_type: 'raw',
            folder: `companies/${company_id}/documents`,
            tags: tags ? JSON.parse(tags) : undefined,
            context: {
                company_id,
                document_type,
                trigger_action
            }
        });

        // Remove temporary file
        await unlinkFile(req.file.path);

        // Parse JSON strings from form data
        const parsedMetadata = metadata ? JSON.parse(metadata) : undefined;
        const parsedConfig = document_config ? JSON.parse(document_config) : undefined;
        const parsedLocations = applicable_locations ? JSON.parse(applicable_locations) : undefined;
        const parsedItems = applicable_items ? JSON.parse(applicable_items) : undefined;
        const parsedEvents = applicable_events ? JSON.parse(applicable_events) : undefined;

        // Create document record
        const document = new Document({
            company_id,
            document_url: uploadResult.secure_url,
            document_type,
            trigger_action,
            at_: new Date(at_),
            title,
            description,
            language,
            requires_signature: requires_signature === 'true',
            expiration_date: expiration_date ? new Date(expiration_date) : undefined,
            applicable_locations: parsedLocations,
            applicable_items: parsedItems,
            applicable_events: parsedEvents,
            tags: tags ? JSON.parse(tags) : undefined,
            metadata: parsedMetadata,
            document_config: parsedConfig,
            created_by
        });

        await document.save();

        res.status(201).json({
            ok: true,
            document
        });

    } catch (error) {
        // If there's a temporary file, clean it up
        if (req.file) {
            await unlinkFile(req.file.path).catch(console.error);
        }
        res.status(500).json({
            ok: false,
            msg: error.message
        });
    }
};

const getCompanyDocuments = async (req, res) => {
    try {
        const { company_id } = req.user;
        const { status, document_type, trigger_action } = req.query;

        const query = { company_id };
        if (status) query.status = status;
        if (document_type) query.document_type = document_type;
        if (trigger_action) query.trigger_action = trigger_action;

        const documents = await Document.find(query).sort({ created_at: -1 });

        res.json({
            ok: true,
            documents
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: error.message
        });
    }
};

const getDocumentTypes = async (req, res) => {
    try {
        const { company_id } = req.user;
        const types = await Document.getCompanyDocumentTypes(company_id);
        res.json({
            ok: true,
            types
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: error.message
        });
    }
};

const getTriggerActions = async (req, res) => {
    try {
        const { company_id } = req.user;
        const actions = await Document.getCompanyTriggerActions(company_id);
        res.json({
            ok: true,
            actions
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: error.message
        });
    }
};

module.exports = {
    uploadDocument,
    getCompanyDocuments,
    getDocumentTypes,
    getTriggerActions
};