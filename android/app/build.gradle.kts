plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.vermeil.phone"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.vermeil.phone"
        minSdk = 26                 // Android 8.0
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
}

// No libraries: only what Android itself has (speech, voice, web view, notifications), so it builds anywhere.
dependencies {
    testImplementation("junit:junit:4.13.2")
}
