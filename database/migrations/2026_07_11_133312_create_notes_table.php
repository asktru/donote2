<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('notes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('team_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('type')->default('note');
            $table->string('date_key', 10)->nullable();
            $table->string('title', 512)->default('');
            $table->longText('content');
            $table->string('folder', 512)->default('');
            $table->boolean('pinned')->default(false);
            $table->unsignedInteger('version')->default(1);
            $table->unsignedBigInteger('server_seq')->default(0);
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['team_id', 'user_id', 'type', 'date_key']);
            $table->index(['team_id', 'user_id', 'server_seq']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('notes');
    }
};
