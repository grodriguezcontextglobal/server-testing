const { Schema, model } = require('mongoose');

const DocumentSchema = Schema({
    company_id: {
        type: String,
        required: true,
        index: true
    },
    document_url: {
        type: String,
        required: true
    },
    document_type: {
        type: String,
        required: true,
        index: true
    },
    trigger_action: {
        type: String,
        required: true,
        index: true
    },
    at_: {
        type: Date,
        required: true,
        index: true
    },
    created_at: {
        type: Date,
        default: Date.now
    },
    replaced_at: {
        type: Date,
        default: null
    },
    version: {
        type: Number,
        required: true,
        default: 1
    },
    status: {
        type: String,
        enum: ['active', 'archived', 'replaced'],
        default: 'active',
        index: true
    },
    // Company-specific document configuration
    document_config: {
        allowed_types: [String],     // Company's allowed document types
        allowed_triggers: [String],  // Company's allowed trigger actions
        validation_rules: Schema.Types.Mixed  // Custom validation rules
    },
    // Additional metadata fields
    title: {
        type: String,
        required: true
    },
    description: {
        type: String
    },
    language: {
        type: String,
        default: 'en'
    },
    requires_signature: {
        type: Boolean,
        default: false
    },
    expiration_date: {
        type: Date
    },
    applicable_locations: [{
        type: String
    }],
    applicable_items: [{
        type: String
    }],
    applicable_events: [{
        type: String
    }],
    tags: [{
        type: String
    }],
    metadata: {
        type: Map,
        of: Schema.Types.Mixed  // Allow any type of metadata
    },
    // Tracking fields
    last_used_at: {
        type: Date
    },
    usage_count: {
        type: Number,
        default: 0
    },
    created_by: {
        type: String,
        required: true
    },
    updated_by: {
        type: String
    }
});

// Validate document_type against company's allowed types
DocumentSchema.pre('save', async function(next) {
    if (this.isModified('document_type') && 
        this.document_config?.allowed_types?.length > 0 && 
        !this.document_config.allowed_types.includes(this.document_type)) {
        throw new Error('Invalid document type for this company');
    }
    
    if (this.isModified('trigger_action') && 
        this.document_config?.allowed_triggers?.length > 0 && 
        !this.document_config.allowed_triggers.includes(this.trigger_action)) {
        throw new Error('Invalid trigger action for this company');
    }
    next();
});

// Indexes for common queries
DocumentSchema.index({ company_id: 1, document_type: 1, status: 1 });
DocumentSchema.index({ company_id: 1, trigger_action: 1, status: 1 });

// Get the latest version of a document
DocumentSchema.statics.getLatestVersion = function(company_id, document_type, trigger_action) {
    return this.findOne({
        company_id,
        document_type,
        trigger_action,
        status: 'active'
    }).sort({ version: -1 });
};

// Get all document types for a company
DocumentSchema.statics.getCompanyDocumentTypes = async function(company_id) {
    const docs = await this.find({ company_id }).distinct('document_type');
    return docs;
};

// Get all trigger actions for a company
DocumentSchema.statics.getCompanyTriggerActions = async function(company_id) {
    const triggers = await this.find({ company_id }).distinct('trigger_action');
    return triggers;
};

// Mark document as replaced
DocumentSchema.methods.markAsReplaced = async function(replaced_by_id) {
    this.status = 'replaced';
    this.replaced_at = new Date();
    await this.save();
};

module.exports = model('Document', DocumentSchema);