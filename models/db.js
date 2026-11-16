
      /*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
    
import { Sequelize } from "sequelize";
import crypto from "node:crypto";
import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  const missing = ["DB_USER", "DB_PASSWORD", "SESSION_SECRET"].filter(key => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
  }
} else {
  if (!process.env.DB_USER) {
    process.env.DB_USER = "root";
    console.warn("DB_USER is unset; using the local development default 'root'. Set DB_USER in .env to override it.");
  }
  if (!process.env.DB_PASSWORD) {
    process.env.DB_PASSWORD = "";
    console.warn("DB_PASSWORD is unset; using an empty password for local development. Set DB_PASSWORD in .env if needed.");
  }
  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = crypto.randomBytes(48).toString("hex");
    console.warn("SESSION_SECRET is unset; using a temporary development secret. Sessions will reset when the server restarts.");
  }
}
const salesTaxRate = Number(process.env.SALES_TAX_RATE || 0);
if (!Number.isFinite(salesTaxRate) || salesTaxRate < 0 || salesTaxRate > 1) {
  throw new Error("SALES_TAX_RATE must be a decimal between 0 and 1.");
}

export const sequelize = new Sequelize(
  process.env.DB_NAME || "pharmacore",
  process.env.DB_USER,
  process.env.DB_PASSWORD || "",
  {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    dialect: "mysql",
    logging: process.env.NODE_ENV === "development" ? console.log : false,
    pool: { max: 10, min: 0, acquire: 30000, idle: 10000 }
});