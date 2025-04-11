const { clientRedis } = require("../database/cacheMemoryConfig");
const Post = require("../models/Post");

const createPost = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    await cache_connection.del(`company_posts=${request.body.company_id}`);
    let post = new Post(request.body);
    await post.save();
    return response.status(201).json({
      post,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const postList = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    //key for cache = company_id
    const companyPostsCached = await cache_connection.get(
      `company_posts=${request.body.company_id}`
    );
    if (companyPostsCached) {
      return response.status(201).json({
        companyPosts: JSON.parse(companyPostsCached),
      });
    } else {
      let companyPosts = await Post.find(request.body);
      cache_connection.set(
        `company_posts=${request.body.company_id}`,
        JSON.stringify(companyPosts)
      );
      cache_connection.expire(`company_posts=${request.body.company_id}`, 180);
      return response.status(201).json({
        ok: true,
        companyPosts,
      });
    }
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const deletePost = async (request, response) => {
  try {
    const { id } = request.params;
    const post = await Post.findByIdAndDelete(id);
    const cache_connection = await clientRedis();
    await cache_connection.del(`company_posts=${post.company_id}`);
    return response.status(201).json({
      ok: true,
      post,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      error,
    });
  }
};

const updatePost = async (request, response) => {
  try {
    const id = request.params.id;
    const template = request.body;
    const updatedPost = {
      ...template,
      updated_at: Date.now(),
    };
    const post = await Post.findByIdAndUpdate(id, updatedPost, {
      new: true,
    });
    const cache_connection = await clientRedis();
    await cache_connection.del(`company_posts=${post.company_id}`);
    return response.status(201).json({
      ok: true,
      post,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      error,
    });
  }
};
module.exports = {
  createPost,
  postList,
  deletePost,
  updatePost,
};
