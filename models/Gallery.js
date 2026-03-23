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
    imageUrls: [{ type: String, required: true }], 
    description: { type: String, default: "" },
    category: { type: String, required: true, default: "일상" },
    reactions: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      type: { type: String, enum: ['heart', 'laugh', 'fire', 'clap', 'party'] }
    }],
    comments: [galleryCommentSchema] 
  },
  { timestamps: true }
);

module.exports = mongoose.model("Gallery", gallerySchema);