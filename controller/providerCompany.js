const { clientRedis } = require("../database/cacheMemoryConfig");
const ProviderCompany = require("../models/ProviderCompany");
const { uploadPdfToS3 } = require("../helpers/s3Upload");
const createProviderCompany = async (req, res) => {
  try {
    const cache_connection = await clientRedis();
    const { companyName, industry, services, address, contactInfo, creator } =
      req.body;

    // Validate required fields
    if (!companyName || !industry || !services || !services.length) {
      return res.status(400).json({
        ok: false,
        msg: "Missing required fields: company name, industry, and services are required",
      });
    }

    // Validate address fields
    if (
      !address ||
      !address.street ||
      !address.city ||
      !address.state ||
      !address.postalCode
    ) {
      return res.status(400).json({
        ok: false,
        msg: "Complete address information is required",
      });
    }

    // Validate contact information
    if (!contactInfo || !contactInfo.email || !contactInfo.phone) {
      return res.status(400).json({
        ok: false,
        msg: "Contact information (email and phone) is required",
      });
    }

    // Validate creator (company reference)
    if (!creator) {
      return res.status(400).json({
        ok: false,
        msg: "Creator company reference is required",
      });
    }

    // Create new provider company
    const providerCompany = new ProviderCompany({
      companyName,
      industry,
      services,
      address: {
        street: address.street,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country || "USA",
      },
      contactInfo: {
        name: String(contactInfo.name).toLowerCase(),
        email: String(contactInfo.email).toLowerCase(),
        phone: contactInfo.phone,
        website: contactInfo.website || "",
      },
      creator,
      documents: [],
      status: "active",
    });

    // Save to database
    await providerCompany.save();

    // Clear related cache if exists
    const cacheKey = `providerCompanies_${creator}`;
    await cache_connection.del(cacheKey);

    return res.status(201).json({
      ok: true,
      msg: "Provider company created successfully",
      providerCompany,
    });
  } catch (error) {
    console.error("Error creating provider company:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error creating provider company",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const getProviderCompanies = async (req, res) => {
  try {
    const cache_connection = await clientRedis();
    const { creator } = req.query;

    // Validate creator parameter
    if (!creator) {
      return res.status(400).json({
        ok: false,
        msg: "Creator parameter is required",
      });
    }

    // // Check cache for provider companies
    const cacheKey = `providerCompanies_${creator}`;
    const cachedProviderCompanies = await cache_connection.get(cacheKey);

    if (cachedProviderCompanies) {
      return res.status(200).json({
        cached: true,
        ok: true,
        providerCompanies: JSON.parse(cachedProviderCompanies),
      });
    }
    // If not in cache, query the database
    const providerCompanies = await ProviderCompany.find({ creator });

    // Cache the result
    await cache_connection.set(cacheKey, JSON.stringify(providerCompanies));
    await cache_connection.expire(cacheKey, 60 * 1); // 24 hours
    return res.status(200).json({
      cached: false,
      ok: true,
      providerCompanies,
    });
  } catch (error) {
    console.error("Error getting provider companies:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error getting provider companies",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const getSpecificProviderCompany = async (req, res) => {
  try {
    const cache_connection = await clientRedis();
    const { creator, provider_id } = req.body;
    // Validate creator parameter
    if (!creator) {
      return res.status(400).json({
        ok: false,
        msg: "Creator parameter is required",
      });
    }

    // // Check cache for provider companies
    const cacheKey = `providerCompanies_${creator}`;
    // const cachedProviderCompanies = await cache_connection.get(cacheKey);

    // if (cachedProviderCompanies) {
    //   const data = JSON.parse(cachedProviderCompanies);
    //   console.log(data);
    //   const provider = data.find(
    //     (provider) => provider._id === provider_id
    //   );

    //   if (!provider) {
    //     return res.status(404).json({
    //       ok: false,
    //       msg: "Provider company not found",
    //     });
    //   }
    //   return res.status(200).json({
    //     cached: true,
    //     ok: true,
    //     providerCompanies: provider,
    //   });
    // }
    // If not in cache, query the database
    const providerCompanies = await ProviderCompany.findById(provider_id);

    // Cache the result
    await cache_connection.set(cacheKey, JSON.stringify(providerCompanies));
    await cache_connection.expire(cacheKey, 60 * 1); // 24 hours
    return res.status(200).json({
      cached: false,
      ok: true,
      providerCompanies,
    });
  } catch (error) {
    console.error("Error getting provider companies:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error getting provider companies",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const updateProviderCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const cache_connection = await clientRedis();
    // Validate if provider company exists
    const existingProvider = await ProviderCompany.findById(id);
    if (!existingProvider) {
      return res.status(404).json({
        ok: false,
        msg: "Provider company not found",
      });
    }

    // Validate required fields if they are being updated
    if (updateData.companyName === "") {
      return res.status(400).json({
        ok: false,
        msg: "Company name cannot be empty",
      });
    }

    if (updateData.services && updateData.services.length === 0) {
      return res.status(400).json({
        ok: false,
        msg: "At least one service must be specified",
      });
    }

    // Validate address fields if being updated
    if (updateData.address) {
      const { street, city, state, postalCode } = updateData.address;
      if (street === "" || city === "" || state === "" || postalCode === "") {
        return res.status(400).json({
          ok: false,
          msg: "All address fields must be filled when updating address",
        });
      }
    }

    // Validate contact information if being updated
    if (updateData.contactInfo) {
      const { email, phone } = updateData.contactInfo;
      if (email === "" || phone === "") {
        return res.status(400).json({
          ok: false,
          msg: "Email and phone are required when updating contact information",
        });
      }

      // Convert email to lowercase if it's being updated
      if (email) {
        updateData.contactInfo.email = email.toLowerCase();
      }
    }

    // Validate status if being updated
    if (
      updateData.status &&
      !["active", "inactive", "pending"].includes(updateData.status)
    ) {
      return res.status(400).json({
        ok: false,
        msg: "Invalid status value",
      });
    }

    // Update the provider company
    const updatedProvider = await ProviderCompany.findByIdAndUpdate(
      id,
      {
        ...updateData,
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    );

    // Clear related cache
    const cacheKey = `providerCompanies_${updatedProvider.creator}`;
    await cache_connection.del(cacheKey);

    return res.status(200).json({
      ok: true,
      msg: "Provider company updated successfully",
      providerCompany: updatedProvider,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: "Error updating provider company",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const deleteProviderCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const cache_connection = await clientRedis();
    // Validate if provider company exists
    const existingProvider = await ProviderCompany.findById(id);
    if (!existingProvider) {
      return res.status(404).json({
        ok: false,
        msg: "Provider company not found",
      });
    }

    // Delete the provider company
    await ProviderCompany.findByIdAndDelete(id);

    // Clear related cache
    const cacheKey = `providerCompanies_${existingProvider.creator}`;
    await cache_connection.del(cacheKey);
    return res.status(200).json({
      ok: true,
      msg: "Provider company deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting provider company:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error deleting provider company",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const uploadProviderDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { document_type, title, company_id, created_by, uploadedAt } =
      req.body;
    const cache_connection = await clientRedis();
    // Check if file exists in request
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        msg: "No file uploaded",
      });
    }

    // Validate provider company exists
    const providerCompany = await ProviderCompany.findById(id);
    if (!providerCompany) {
      return res.status(404).json({
        ok: false,
        msg: "Provider company not found",
      });
    }
    console.log("providerCompany", providerCompany);
    // Upload file to S3
    const uploadResult = await uploadPdfToS3(req.file, {
      companyId: providerCompany.creator.toString(), // Use creator's company ID for folder structure
      documentType: `provider_${document_type}`, // Prefix to distinguish provider documents
      metadata: {
        providerId: company_id,
        providerName: providerCompany.companyName,
        uploadedBy: req.user?.id || "system",
      },
    });

    // Create document record
    const newDocument = {
      name: req.file.originalname,
      url: uploadResult.Location,
      type: document_type,
      uploadedAt: uploadedAt,
    };

    // Add document to provider company's documents array
    providerCompany.documents.push(newDocument);
    await providerCompany.save();

    // Clear cache
    const cacheKey = `providerCompanies_${providerCompany.creator}`;
    await cache_connection.del(cacheKey);

    return res.status(200).json({
      ok: true,
      msg: "Document uploaded successfully",
      document: newDocument,
    });
  } catch (error) {
    console.error("Error uploading provider document:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error uploading document",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  createProviderCompany,
  getProviderCompanies,
  updateProviderCompany,
  deleteProviderCompany,
  uploadProviderDocument,
  getSpecificProviderCompany,
};
