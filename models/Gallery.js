const mongoose = require("mongoose");

const galleryCommentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const gallerySchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
    uploaderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    imageUrl: { type: String, required: true }, // 儲存照片路徑
    description: { type: String, default: "" }, // 照片說明
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    comments: [galleryCommentSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Gallery", gallerySchema);