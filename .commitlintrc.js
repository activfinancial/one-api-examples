module.exports = {
    extends: ['@commitlint/config-conventional'],
    rules: {
        "subject-full-stop": [2, "always", "."],
        "header-max-length": [1, "always", 132],
    }
};
