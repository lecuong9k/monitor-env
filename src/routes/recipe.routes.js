import {
  getRecipesController,
  getRecipeController,
  getRecipeByDeviceController,
  createRecipeController,
} from "../controllers/recipe.controller.js";

export default async function recipeRoutes(fastify) {
  fastify.get("/recipes", getRecipesController);
  fastify.get("/recipes/:id", getRecipeController);
  fastify.get("/recipes/device/:deviceId", getRecipeByDeviceController);
  fastify.post("/recipes", createRecipeController);
}
