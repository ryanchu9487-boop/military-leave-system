const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { passwordValidator } = require("../src/utils/validators");

const SALT_ROUNDS = 10;

const userSchema = new mongoose.Schema(
  {
    // --- 소속 ---
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },

    // --- 기본 정보 ---
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    rank: {
      type: String,
      required: true,
      trim: true,
    },

    serviceNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    phoneNumber: {
      type: String,
      required: true,
      trim: true,
      // 유효성 검사 예시 (010-1234-5678)
      validate: {
        validator: function (v) {
          return /^\d{3}-\d{3,4}-\d{4}$/.test(v);
        },
        message: (props) => `${props.value}는 올바른 전화번호 형식이 아닙니다!`,
      },
    },

    password: {
      type: String,
      required: true,
      select: false,
      validate: passwordValidator,
    },

    // --- 군용 단일 권한 ---
    role: {
      type: String,
      // 增加 officer (간부), 保留 reviewer (검토자), approver (승인자)
      enum: ["soldier", "officer", "reviewer", "approver"],
      default: "soldier",
      index: true,
    },

    // --- 승인 상태 ---
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    // --- 보안 ---
    mustChangePassword: { type: Boolean, default: false }, // 관리자가 초기화 시 true

    isActive: { type: Boolean, default: true, index: true },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

//
// 🔐 Multi-Tenant 핵심 인덱스
//

// 조직 내부에서만 군번 유일
userSchema.index({ organizationId: 1, serviceNumber: 1 }, { unique: true });

// 조직 + 부대 + 이름 검색 최적화
userSchema.index(
  { organizationId: 1, serviceNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { organizationId: { $exists: true, $ne: null } },
  }
);

//
// 비밀번호 암호화
//
userSchema.pre("save", async function (next) {
  // 비밀번호가 변경되거나 새로 생성될 때만 해싱
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

module.exports = mongoose.model("User", userSchema);
